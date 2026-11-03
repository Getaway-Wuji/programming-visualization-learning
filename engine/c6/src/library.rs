//! Closed, bounded virtual stdio/string/ASCII/math operations. No host libc or I/O.
use crate::{
    formats::{self, Part},
    runtime::{Access, Deps, Eval, IoEvent, Place, Runtime},
    state,
    syntax::{Expr, Fault, Id, Kind},
    types::{Ty, Val},
};
use serde_json::{Value, json};

fn whitespace(b: u8) -> bool {
    b == b' ' || (9..=13).contains(&b)
}
fn float_text(value: f64, code: u8, precision: Option<usize>) -> String {
    let p = precision.unwrap_or(6);
    fn scientific(v: f64, p: usize, trim: bool) -> String {
        let raw = format!("{v:.p$e}");
        let (mantissa, exponent) = raw.split_once('e').unwrap();
        let exponent = exponent.parse::<i32>().unwrap();
        let mantissa = if trim {
            mantissa.trim_end_matches('0').trim_end_matches('.')
        } else {
            mantissa
        };
        format!(
            "{mantissa}e{}{exponent:02}",
            if exponent < 0 { "-" } else { "+" },
            exponent = exponent.abs()
        )
    }
    match code {
        b'f' => format!("{value:.p$}"),
        b'e' => scientific(value, p, false),
        _ => {
            let p = p.max(1);
            let raw = format!("{value:.digits$e}", digits = p - 1);
            let exponent = raw.split_once('e').unwrap().1.parse::<i32>().unwrap();
            if exponent < -4 || exponent >= p as i32 {
                scientific(value, p - 1, true)
            } else {
                let digits = (p as i32 - 1 - exponent).max(0) as usize;
                let s = format!("{value:.digits$}");
                if s.contains('.') {
                    s.trim_end_matches('0').trim_end_matches('.').into()
                } else {
                    s
                }
            }
        }
    }
}
impl Runtime<'_, '_> {
    fn literal_format(&self, id: Id) -> Vec<u8> {
        let Kind::Expression(Expr::String(s)) = &self.checked.program.nodes[id].kind else {
            unreachable!("checked static format")
        };
        s.clone()
    }
    fn next_input_deps(&self, id: Id, value: &Val) -> Deps {
        let mut deps = self.evidence(&["input.source"], id, vec![], value, "");
        for proof in deps.values_mut() {
            proof.seq = self.journal.steps.len() + 1;
        }
        deps
    }
    fn input_control(&self, cursor: usize) -> Value {
        let mut control = self.journal.state["control"].clone();
        control["inputCursor"] = json!(cursor);
        state::singleton(&self.journal.state, "control", control)
    }
    fn return_library(
        &mut self,
        value: Val,
        ty: Ty,
        mut deps: Deps,
        name: &str,
        id: Id,
        objects: Vec<String>,
    ) -> Result<Eval, Fault> {
        deps.extend(self.control_deps.clone());
        deps.extend(self.call_deps.clone());
        let tags: &[&str] = match name {
            "getchar" => &["library.getchar", "char.promotion"],
            "scanf" => &["input.scan-result", "library.scanf-return"],
            "strlen" => &["string.length", "library.strlen"],
            "strcmp" | "strncmp" => &["string.compare", "library.strcmp"],
            "strcpy" => &["string.copy", "library.strcpy"],
            "strncpy" | "strcat" | "strncat" => &["string.copy"],
            _ => &[],
        };
        deps.extend(self.evidence(tags, id, objects, &value, ""));
        Ok(Eval {
            value,
            ty,
            deps,
            constant: false,
            access: Access::default(),
        })
    }
    fn char_capacity(&self, value: &Eval, id: Id, writable: bool) -> Result<(Place, usize), Fault> {
        let p = self.pointer_place(value, id)?;
        if p.ty.bare() != &Ty::Char {
            return Err(self.err("E_TYPE_INVALID", id));
        }
        self.validate(&p, writable, false, id)?;
        let available = p
            .upper
            .checked_sub(p.offset)
            .filter(|n| *n <= 64)
            .ok_or_else(|| self.err("E_STRING_BOUNDS", id))?;
        Ok((p, available))
    }
    fn read_text(
        &mut self,
        value: &Eval,
        max: Option<usize>,
        id: Id,
    ) -> Result<(Vec<u8>, Deps, Access, bool), Fault> {
        let (p, available) = self.char_capacity(value, id, false)?;
        let limit = max.unwrap_or(available).min(available);
        let mut text = vec![];
        let mut deps = value.deps.clone();
        let mut access = value.access.clone();
        for at in 0..limit {
            self.tick(id, 1)?;
            let mut p = p.clone();
            p.offset += at;
            let v = self.read(p, id)?;
            deps.extend(v.deps);
            access.merge(&v.access);
            let Val::C(byte) = v.value else {
                return Err(self.err("E_TYPE_INVALID", id));
            };
            if byte == 0 {
                return Ok((text, deps, access, true));
            }
            text.push(byte);
        }
        if max.is_none() {
            return Err(self.err("E_STRING_UNTERMINATED", id));
        }
        Ok((text, deps, access, false))
    }
    fn text_updates(
        &self,
        p: &Place,
        bytes: &[u8],
        deps: &Deps,
        id: Id,
    ) -> Result<Vec<(Place, Eval)>, Fault> {
        let mut out = vec![];
        for (i, byte) in bytes.iter().copied().enumerate() {
            let mut target = p.clone();
            target.offset += i;
            self.validate(&target, true, false, id)?;
            let mut value = Eval::plain(Val::C(byte));
            value.constant = false;
            value.deps = deps.clone();
            out.push((target, value));
        }
        Ok(out)
    }
    fn emit_output(&mut self, id: Id, text: String, deps: Deps) -> Result<(), Fault> {
        let before = self.journal.state["output"].as_str().unwrap().len();
        let after = before + text.len();
        if after > self.meter.limits().output_bytes {
            return Err(self.err("E_OUTPUT_LIMIT", id));
        }
        self.emit(
            id,
            "output.append",
            vec![json!({"op":"output","beforeBytes":before,"afterBytes":after,"append":text})],
        )?;
        self.output_deps.extend(deps);
        self.output_deps.extend(self.control_deps.clone());
        self.output_deps.extend(self.call_deps.clone());
        Ok(())
    }
    pub fn library(&mut self, name: &str, args: &[Id], id: Id) -> Result<Eval, Fault> {
        self.tick(id, 1)?;
        if name == "getchar" {
            let at = self.journal.state["control"]["inputCursor"]
                .as_u64()
                .unwrap() as usize;
            let value = Val::I(self.input.get(at).map_or(-1, |b| i32::from(*b)));
            let cursor = at + usize::from(at < self.input.len());
            self.emit(id, "input.read", vec![self.input_control(cursor)])?;
            self.io.push(IoEvent {
                name: "getchar",
                node: id,
                seq: self.journal.steps.len(),
                before: at,
                after: cursor,
                result: value.clone(),
                written: vec![],
            });
            let deps = self.evidence(&["input.source"], id, vec![], &value, "");
            return self.return_library(value, Ty::Int, deps, name, id, vec![]);
        }
        if name == "scanf" {
            return self.scanf(args, id);
        }
        if name == "fgets" {
            return self.fgets(args, id);
        }
        if name == "printf" {
            return self.printf(args, id);
        }
        let mut values = vec![];
        let mut accesses = Access::default();
        for &arg in args {
            let value = self.expression(arg)?;
            if accesses.unsequenced(&value.access) {
                return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
            }
            accesses.merge(&value.access);
            values.push(value);
        }
        match name {
            "puts" => {
                let (bytes, deps, _, _) = self.read_text(&values[0], None, id)?;
                let mut text = String::from_utf8(bytes).unwrap();
                text.push('\n');
                let count = text.len();
                self.emit_output(id, text, deps.clone())?;
                self.return_library(Val::I(count as i32), Ty::Int, deps, name, id, vec![])
            }
            "putchar" => {
                let n = values[0]
                    .value
                    .cast(&Ty::Int)
                    .and_then(|v| v.int())
                    .map_err(|c| self.err(c, id))?;
                if !(0..=127).contains(&n) {
                    return Err(self.err("E_CHAR_DOMAIN", id));
                }
                self.emit_output(id, (n as u8 as char).to_string(), values[0].deps.clone())?;
                self.return_library(Val::I(n), Ty::Int, values[0].deps.clone(), name, id, vec![])
            }
            "isalpha" | "isdigit" | "isspace" | "toupper" | "tolower" => {
                let n = values[0]
                    .value
                    .cast(&Ty::Int)
                    .and_then(|v| v.int())
                    .map_err(|c| self.err(c, id))?;
                if !(-1..=127).contains(&n) {
                    return Err(self.err("E_CHAR_DOMAIN", id));
                }
                let byte = n as u8;
                let value = if n == -1 {
                    if name == "toupper" || name == "tolower" {
                        -1
                    } else {
                        0
                    }
                } else {
                    match name {
                        "isalpha" => i32::from(byte.is_ascii_alphabetic()),
                        "isdigit" => i32::from(byte.is_ascii_digit()),
                        "isspace" => i32::from(whitespace(byte)),
                        "toupper" => i32::from(byte.to_ascii_uppercase()),
                        _ => i32::from(byte.to_ascii_lowercase()),
                    }
                };
                self.emit(id, "c6.library", vec![])?;
                self.return_library(
                    Val::I(value),
                    Ty::Int,
                    values[0].deps.clone(),
                    name,
                    id,
                    vec![],
                )
            }
            "fabs" | "sqrt" => {
                let n = values[0].value.real().map_err(|c| self.err(c, id))?;
                let value = if name == "fabs" { n.abs() } else { n.sqrt() };
                if !value.is_finite() {
                    return Err(self.err("E_FLOAT_NONFINITE", id));
                }
                self.emit(id, "c6.library", vec![])?;
                self.return_library(
                    Val::D(value),
                    Ty::F64,
                    values[0].deps.clone(),
                    name,
                    id,
                    vec![],
                )
            }
            "strlen" => {
                let (bytes, deps, _, _) = self.read_text(&values[0], None, id)?;
                self.emit(id, "c6.library", vec![])?;
                self.return_library(Val::U(bytes.len() as u32), Ty::UInt, deps, name, id, vec![])
            }
            "strcmp" | "strncmp" => {
                let n = if name == "strncmp" {
                    Some(self.string_count(&values[2], id)?)
                } else {
                    None
                };
                let (a, mut deps, _, _) = self.read_text(&values[0], n, id)?;
                let (b, other, _, _) = self.read_text(&values[1], n, id)?;
                deps.extend(other);
                if let Some(v) = values.get(2) {
                    deps.extend(v.deps.clone())
                }
                let result = match a.cmp(&b) {
                    std::cmp::Ordering::Less => -1,
                    std::cmp::Ordering::Equal => 0,
                    std::cmp::Ordering::Greater => 1,
                };
                self.emit(id, "c6.library", vec![])?;
                self.return_library(Val::I(result), Ty::Int, deps, name, id, vec![])
            }
            "strcpy" | "strncpy" | "strcat" | "strncat" => self.copy_string(name, &values, id),
            "strchr" => {
                let needle = values[1]
                    .value
                    .cast(&Ty::Int)
                    .and_then(|v| v.int())
                    .map_err(|c| self.err(c, id))?;
                if !(0..=127).contains(&needle) {
                    return Err(self.err("E_CHAR_DOMAIN", id));
                }
                let (bytes, mut deps, _, _) = self.read_text(&values[0], None, id)?;
                deps.extend(values[1].deps.clone());
                let index = if needle == 0 {
                    Some(bytes.len())
                } else {
                    bytes.iter().position(|b| i32::from(*b) == needle)
                };
                let value = if let Some(index) = index {
                    let mut pointer = values[0].value.clone();
                    let Val::P(p) = &mut pointer else {
                        unreachable!()
                    };
                    p.byte_offset += index;
                    pointer
                } else {
                    let Ty::Pointer(t) = values[0].ty.bare() else {
                        unreachable!()
                    };
                    Val::null(t)
                };
                self.emit(id, "c6.library", vec![])?;
                self.return_library(value, values[0].ty.clone(), deps, name, id, vec![])
            }
            _ => Err(self.err("E_UNSUPPORTED_SYNTAX", id)),
        }
    }
    fn string_count(&self, value: &Eval, id: Id) -> Result<usize, Fault> {
        let n = value.value.real().map_err(|c| self.err(c, id))?;
        if !(0.0..=64.0).contains(&n) {
            return Err(self.err("E_STRING_BOUNDS", id));
        }
        Ok(n as usize)
    }
    fn printf(&mut self, args: &[Id], id: Id) -> Result<Eval, Fault> {
        let parts = formats::print(&self.literal_format(args[0])).map_err(|c| self.err(c, id))?;
        let mut values = vec![];
        let mut accesses = Access::default();
        for &arg in &args[1..] {
            let value = self.expression(arg)?;
            if accesses.unsequenced(&value.access) {
                return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
            }
            accesses.merge(&value.access);
            values.push(value);
        }
        let mut output = String::new();
        let mut index = 0;
        let mut deps = Deps::new();
        for part in parts {
            match part {
                Part::Text(t) => output.push_str(&t),
                Part::Conversion {
                    code,
                    width,
                    precision,
                } => {
                    let value = &values[index];
                    index += 1;
                    deps.extend(value.deps.clone());
                    let text = match code {
                        b'd' => value.value.int().map_err(|c| self.err(c, id))?.to_string(),
                        b'u' => value.value.uint().map_err(|c| self.err(c, id))?.to_string(),
                        b'o' => format!("{:o}", value.value.uint().map_err(|c| self.err(c, id))?),
                        b'x' => format!("{:x}", value.value.uint().map_err(|c| self.err(c, id))?),
                        b'X' => format!("{:X}", value.value.uint().map_err(|c| self.err(c, id))?),
                        b'c' => {
                            let n = value.value.int().map_err(|c| self.err(c, id))?;
                            if !(0..=127).contains(&n) {
                                return Err(self.err("E_CHAR_DOMAIN", id));
                            }
                            (n as u8 as char).to_string()
                        }
                        b's' => {
                            let (mut text, d, _, _) = self.read_text(value, None, id)?;
                            deps.extend(d);
                            if let Some(n) = precision {
                                text.truncate(n)
                            }
                            String::from_utf8(text).unwrap()
                        }
                        b'f' | b'e' | b'g' => float_text(
                            value.value.real().map_err(|c| self.err(c, id))?,
                            code,
                            precision,
                        ),
                        b'p' => {
                            let Val::P(p) = &value.value else {
                                unreachable!()
                            };
                            if let Some(object) = &p.object_id {
                                let at = object[1..].parse::<usize>().unwrap() - 1;
                                format!(
                                    "vaddr:0x{:08x}",
                                    self.journal.state["objects"][at]["baseAddress"]
                                        .as_u64()
                                        .unwrap()
                                        + p.byte_offset as u64
                                )
                            } else {
                                "vaddr:null".into()
                            }
                        }
                        _ => unreachable!(),
                    };
                    if let Some(width) = width {
                        for _ in text.len()..width {
                            output.push(' ')
                        }
                    }
                    output.push_str(&text);
                }
            }
            if output.len() > self.meter.limits().output_bytes {
                return Err(self.err("E_OUTPUT_LIMIT", id));
            }
        }
        let size = output.len();
        self.emit_output(id, output, deps.clone())?;
        let output_proof = self.evidence(&["output.data"], id, vec![], &Val::I(size as i32), "");
        self.output_deps.extend(output_proof);
        let mut result =
            self.return_library(Val::I(size as i32), Ty::Int, deps, "printf", id, vec![])?;
        result
            .deps
            .extend(self.evidence(&["output.data"], id, vec![], &result.value, ""));
        Ok(result)
    }
    fn fgets(&mut self, args: &[Id], id: Id) -> Result<Eval, Fault> {
        let target = self.expression(args[0])?;
        let n = self.expression(args[1])?;
        if target.access.unsequenced(&n.access) {
            return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
        }
        let (p, capacity) = self.char_capacity(&target, id, true)?;
        let count = n.value.real().map_err(|c| self.err(c, id))?;
        if count < 2.0 || count > capacity as f64 {
            return Err(self.err("E_STRING_BOUNDS", id));
        }
        let start = self.journal.state["control"]["inputCursor"]
            .as_u64()
            .unwrap() as usize;
        if start == self.input.len() {
            self.emit(id, "input.read", vec![self.input_control(start)])?;
            let Ty::Pointer(base) = target.ty.bare() else {
                unreachable!()
            };
            let value = Val::null(base);
            self.io.push(IoEvent {
                name: "fgets",
                node: id,
                seq: self.journal.steps.len(),
                before: start,
                after: start,
                result: value.clone(),
                written: vec![],
            });
            let deps = self.evidence(&["input.source"], id, vec![], &value, "");
            return self.return_library(value, target.ty, deps, "fgets", id, vec![]);
        }
        let mut end = start;
        while end < self.input.len() && end - start < (count as usize) - 1 {
            let byte = self.input[end];
            end += 1;
            if byte == b'\n' {
                break;
            }
        }
        let mut bytes = self.input[start..end].to_vec();
        bytes.push(0);
        let mut deps = self.next_input_deps(id, &target.value);
        deps.extend(target.deps.clone());
        deps.extend(n.deps.clone());
        let updates = self.text_updates(&p, &bytes, &deps, id)?;
        let written = updates.iter().map(|(p, _)| (p.object, p.offset)).collect();
        self.writes(
            updates,
            id,
            false,
            vec![self.input_control(end)],
            "input.read",
        )?;
        self.io.push(IoEvent {
            name: "fgets",
            node: id,
            seq: self.journal.steps.len(),
            before: start,
            after: end,
            result: target.value.clone(),
            written,
        });
        self.return_library(target.value, target.ty, deps, "fgets", id, vec![])
    }
    fn scanf(&mut self, args: &[Id], id: Id) -> Result<Eval, Fault> {
        let format = formats::scan(&self.literal_format(args[0])).map_err(|c| self.err(c, id))?;
        let target = self.expression(args[1])?;
        let p = self.pointer_place(&target, id)?;
        self.validate(&p, true, false, id)?;
        if format.code == "s" {
            let (_, cap) = self.char_capacity(&target, id, true)?;
            if format.width.unwrap() >= cap {
                return Err(self.err("E_STRING_BOUNDS", id));
            }
        }
        let mut at = self.journal.state["control"]["inputCursor"]
            .as_u64()
            .unwrap() as usize;
        let before = at;
        if format.code != "c" || format.leading_space {
            while self.input.get(at).is_some_and(|b| whitespace(*b)) {
                at += 1
            }
        }
        let mut updates = vec![];
        let result;
        if at == self.input.len() {
            result = -1;
        } else if format.code == "c" {
            let value = Val::C(self.input[at]);
            at += 1;
            let mut v = Eval::plain(value);
            v.constant = false;
            v.deps = self.next_input_deps(id, &Val::I(1));
            updates.push((p, v));
            result = 1;
        } else if format.code == "s" {
            let start = at;
            let count = format.width.unwrap();
            while at < self.input.len() && at - start < count && !whitespace(self.input[at]) {
                at += 1
            }
            let mut bytes = self.input[start..at].to_vec();
            bytes.push(0);
            updates = self.text_updates(&p, &bytes, &self.next_input_deps(id, &Val::I(1)), id)?;
            result = 1;
        } else {
            let start = at;
            if matches!(self.input.get(at), Some(b'+') | Some(b'-')) {
                at += 1
            }
            let negative = self.input[start] == b'-';
            let digits_start = at;
            let floating = format.code == "f" || format.code == "lf";
            if floating {
                let tail = &self.input[at..];
                if tail.len() >= 3
                    && (tail[..3].eq_ignore_ascii_case(b"inf")
                        || tail[..3].eq_ignore_ascii_case(b"nan"))
                {
                    return Err(self.err("E_FLOAT_NONFINITE", id));
                }
                if tail.starts_with(b"0x") || tail.starts_with(b"0X") {
                    return Err(self.err("E_INPUT_INVALID", id));
                }
            }
            while self.input.get(at).is_some_and(u8::is_ascii_digit) {
                at += 1
            }
            let mut digits = at - digits_start;
            if floating && self.input.get(at) == Some(&b'.') {
                at += 1;
                let start = at;
                while self.input.get(at).is_some_and(u8::is_ascii_digit) {
                    at += 1
                }
                digits += at - start;
            }
            let mut valid = digits > 0;
            if floating && digits > 0 && matches!(self.input.get(at), Some(b'e') | Some(b'E')) {
                at += 1;
                if matches!(self.input.get(at), Some(b'+') | Some(b'-')) {
                    at += 1
                }
                let exponent = at;
                while self.input.get(at).is_some_and(u8::is_ascii_digit) {
                    at += 1
                }
                valid = at > exponent;
            }
            if !valid {
                result = 0;
            } else {
                let text = std::str::from_utf8(&self.input[start..at]).unwrap();
                let value = match format.code {
                    "d" => {
                        let n = text
                            .parse::<i64>()
                            .map_err(|_| self.err("E_OVERFLOW", id))?;
                        Val::I(i32::try_from(n).map_err(|_| self.err("E_OVERFLOW", id))?)
                    }
                    "u" => {
                        let magnitude = std::str::from_utf8(&self.input[digits_start..at])
                            .unwrap()
                            .parse::<u64>()
                            .map_err(|_| self.err("E_OVERFLOW", id))?;
                        let n = u32::try_from(magnitude).map_err(|_| self.err("E_OVERFLOW", id))?;
                        Val::U(if negative { n.wrapping_neg() } else { n })
                    }
                    "f" => {
                        let n = text
                            .parse::<f32>()
                            .map_err(|_| self.err("E_INPUT_INVALID", id))?;
                        if !n.is_finite() {
                            return Err(self.err("E_FLOAT_NONFINITE", id));
                        }
                        Val::F(n)
                    }
                    _ => {
                        let n = text
                            .parse::<f64>()
                            .map_err(|_| self.err("E_INPUT_INVALID", id))?;
                        if !n.is_finite() {
                            return Err(self.err("E_FLOAT_NONFINITE", id));
                        }
                        Val::D(n)
                    }
                };
                let mut v = Eval::plain(value);
                v.constant = false;
                v.deps = self.next_input_deps(id, &Val::I(1));
                updates.push((p, v));
                result = 1;
            }
        }
        let written = updates.iter().map(|(p, _)| (p.object, p.offset)).collect();
        self.writes(
            updates,
            id,
            false,
            vec![self.input_control(at)],
            "input.read",
        )?;
        let value = Val::I(result);
        self.io.push(IoEvent {
            name: "scanf",
            node: id,
            seq: self.journal.steps.len(),
            before,
            after: at,
            result: value.clone(),
            written,
        });
        let deps = self.evidence(&["input.source"], id, vec![], &value, "");
        self.return_library(value, Ty::Int, deps, "scanf", id, vec![])
    }
    fn copy_string(&mut self, name: &str, args: &[Eval], id: Id) -> Result<Eval, Fault> {
        let (p, capacity) = self.char_capacity(&args[0], id, true)?;
        let source = self.pointer_place(&args[1], id)?;
        self.validate(&source, false, false, id)?;
        let n = if args.len() == 3 {
            Some(self.string_count(&args[2], id)?)
        } else {
            None
        };
        let (src, mut deps, _, terminated) = self.read_text(&args[1], n, id)?;
        deps.extend(args[0].deps.clone());
        if let Some(v) = args.get(2) {
            deps.extend(v.deps.clone())
        }
        let append = name == "strcat" || name == "strncat";
        let start = if append {
            let (dst, d, _, _) = self.read_text(&args[0], None, id)?;
            deps.extend(d);
            dst.len()
        } else {
            0
        };
        let mut bytes = src.clone();
        if name == "strncpy" {
            bytes.resize(n.unwrap(), 0)
        } else {
            bytes.push(0)
        }
        if start + bytes.len() > capacity {
            return Err(self.err("E_STRING_BOUNDS", id));
        }
        let source_read = src.len() + usize::from(terminated);
        let write_start = p.offset + start;
        let write_end = write_start + bytes.len();
        let destination_start = if append { p.offset } else { write_start };
        if p.object == source.object
            && destination_start < source.offset + source_read
            && source.offset < write_end
        {
            return Err(self.err("E_STRING_BOUNDS", id));
        }
        let mut dest = p.clone();
        dest.offset += start;
        let oid = self.journal.state["objects"][p.object]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let sid = self.journal.state["objects"][source.object]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let mut proof = self.evidence(
            &[
                "string.copy",
                if name == "strcpy" {
                    "library.strcpy"
                } else {
                    "string.copy"
                },
            ],
            id,
            vec![oid.clone(), sid.clone()],
            &args[0].value,
            "",
        );
        for v in proof.values_mut() {
            v.seq = self.journal.steps.len() + 1;
        }
        deps.extend(proof);
        let updates = self.text_updates(&dest, &bytes, &deps, id)?;
        self.writes(updates, id, false, vec![], "c6.library")?;
        self.return_library(
            args[0].value.clone(),
            args[0].ty.clone(),
            deps,
            name,
            id,
            vec![oid, sid],
        )
    }
}
