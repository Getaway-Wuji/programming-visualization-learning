//! C6 execution state and typed memory. All observable mutation goes through the journal.
use crate::{
    budget::Meter,
    check::Checked,
    source::ByteRange,
    state::{self, Journal, Totals},
    syntax::{self, Fault, Id},
    types::{self, Ty, Val},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub type Deps = BTreeMap<String, Proof>;
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proof {
    pub tag: String,
    pub node_id: String,
    pub seq: usize,
    pub object_ids: Vec<String>,
    pub value: Value,
}
#[derive(Clone, Debug, Default)]
pub struct Access {
    pub reads: BTreeSet<(usize, usize)>,
    pub writes: BTreeSet<(usize, usize)>,
}
impl Access {
    pub fn merge(&mut self, b: &Self) {
        self.reads.extend(&b.reads);
        self.writes.extend(&b.writes);
    }
    pub fn unsequenced(&self, b: &Self) -> bool {
        self.writes
            .iter()
            .any(|x| b.reads.contains(x) || b.writes.contains(x))
            || b.writes.iter().any(|x| self.reads.contains(x))
    }
}
#[derive(Clone, Debug)]
pub struct Eval {
    pub value: Val,
    pub ty: Ty,
    pub deps: Deps,
    pub constant: bool,
    pub access: Access,
}
impl Eval {
    pub fn plain(value: Val) -> Self {
        let ty = value.ty();
        Self {
            value,
            ty,
            deps: Deps::new(),
            constant: true,
            access: Access::default(),
        }
    }
    pub fn cast(mut self, ty: &Ty) -> Result<Self, &'static str> {
        self.value = self.value.cast(ty)?;
        self.ty = ty.clone();
        Ok(self)
    }
}
#[derive(Clone, Debug)]
pub struct Place {
    pub object: usize,
    pub offset: usize,
    pub ty: Ty,
    pub lower: usize,
    pub upper: usize,
    pub pointer: bool,
    pub explicit_deref: bool,
    pub deps: Deps,
    pub access: Access,
}
pub struct ObjectMeta {
    pub ty: Ty,
    pub declaration: Id,
    pub parameter: bool,
    pub static_local: bool,
    pub ended_at: Option<usize>,
    pub initialized: bool,
    pub declaration_deps: Deps,
}
pub struct Allocation {
    pub storage: &'static str,
    pub zero: bool,
    pub writable: bool,
    pub parameter: bool,
}
pub struct Environment {
    pub scope: String,
    pub bindings: BTreeMap<String, usize>,
}
pub struct Activation {
    pub function: usize,
    pub frame: String,
    pub env: Vec<Environment>,
}
#[derive(Clone, Debug)]
pub struct MemoryAccess {
    pub object: usize,
    pub offset: usize,
    pub write: bool,
    pub initialization: bool,
    pub node: Id,
    pub seq: usize,
}
pub struct BranchEvent {
    pub node: Id,
    pub seq: usize,
    pub truth: bool,
    pub deps: Deps,
}
pub struct IoEvent {
    pub name: &'static str,
    pub node: Id,
    pub seq: usize,
    pub before: usize,
    pub after: usize,
    pub result: Val,
    pub written: Vec<(usize, usize)>,
}
pub struct CallEvent {
    pub function: String,
    pub node: Id,
    pub entry_seq: usize,
    pub exit_seq: usize,
    pub recursive: bool,
    pub arguments: Vec<Val>,
    pub result: Eval,
}
pub struct UserWrite {
    pub object: usize,
    pub offset: usize,
    pub node: Id,
    pub seq: usize,
    pub pointer: bool,
    pub frame_id: Option<String>,
    pub before: Value,
    pub after: Value,
    pub loop_node: Option<String>,
}
pub struct Runtime<'a, 'm> {
    pub checked: &'a Checked,
    pub meter: &'m mut Meter,
    pub totals: &'m mut Totals,
    pub journal: Journal,
    pub input: &'a [u8],
    pub activations: Vec<Activation>,
    pub global: Option<Environment>,
    pub objects: Vec<ObjectMeta>,
    pub statics: BTreeMap<Id, usize>,
    pub literals: BTreeMap<Id, usize>,
    pub cell_deps: BTreeMap<(usize, usize), Deps>,
    pub cell_constants: BTreeMap<(usize, usize), bool>,
    pub watch: BTreeSet<String>,
    pub output_deps: Deps,
    pub control_deps: Deps,
    pub call_deps: Deps,
    pub depth: usize,
    pub peak_depth: usize,
    pub accesses: Vec<MemoryAccess>,
    pub call_counts: BTreeMap<String, usize>,
    pub branches: Vec<BranchEvent>,
    pub io: Vec<IoEvent>,
    pub calls: Vec<CallEvent>,
    pub user_writes: Vec<UserWrite>,
    pub recursion_entries: usize,
}
impl<'a, 'm> Runtime<'a, 'm> {
    pub fn new(
        checked: &'a Checked,
        input: &'a [u8],
        watch: BTreeSet<String>,
        metadata_bytes: usize,
        totals: &'m mut Totals,
        meter: &'m mut Meter,
    ) -> Result<Self, Fault> {
        let p = &checked.program;
        let journal = Journal::new(
            p.root,
            metadata_bytes,
            &checked.types,
            totals,
            meter,
            p.nodes[p.root].range,
        )?;
        Ok(Self {
            checked,
            meter,
            totals,
            journal,
            input,
            activations: vec![],
            global: None,
            objects: vec![],
            statics: BTreeMap::new(),
            literals: BTreeMap::new(),
            cell_deps: BTreeMap::new(),
            cell_constants: BTreeMap::new(),
            watch,
            output_deps: Deps::new(),
            control_deps: Deps::new(),
            call_deps: BTreeMap::new(),
            depth: 0,
            peak_depth: 0,
            accesses: vec![],
            call_counts: BTreeMap::new(),
            branches: vec![],
            io: vec![],
            calls: vec![],
            user_writes: vec![],
            recursion_entries: 0,
        })
    }
    pub fn range(&self, id: Id) -> ByteRange {
        self.checked.program.nodes[id].range
    }
    pub fn err(&self, c: &'static str, id: Id) -> Fault {
        syntax::fault(c, self.range(id))
    }
    pub fn tick(&mut self, id: Id, n: usize) -> Result<(), Fault> {
        syntax::charge(self.meter, n, self.range(id))
    }
    pub fn guarded<T>(
        &mut self,
        id: Id,
        f: impl FnOnce(&mut Self) -> Result<T, Fault>,
    ) -> Result<T, Fault> {
        if self.depth >= 256 {
            return Err(self.err("E_DEPTH_LIMIT", id));
        }
        self.depth += 1;
        self.peak_depth = self.peak_depth.max(self.depth);
        let r = f(self);
        self.depth -= 1;
        r
    }
    pub fn emit(&mut self, id: Id, kind: &str, changes: Vec<Value>) -> Result<usize, Fault> {
        let r = self.range(id);
        self.journal.emit(
            id,
            kind,
            changes,
            state::Emission {
                types: &self.checked.types,
                totals: self.totals,
                meter: self.meter,
                range: r,
            },
        )
    }
    pub fn evidence(
        &self,
        tags: &[&str],
        id: Id,
        objects: Vec<String>,
        value: &Val,
        role: &str,
    ) -> Deps {
        let mut deps = Deps::new();
        for tag in tags {
            if self.watch.contains(*tag) || *tag == "input.source" {
                deps.insert(
                    format!("{tag}:{role}"),
                    Proof {
                        tag: (*tag).into(),
                        node_id: state::nid(id),
                        seq: self.journal.steps.len(),
                        object_ids: objects.clone(),
                        value: value.wire(),
                    },
                );
            }
        }
        deps
    }
    pub fn attach(
        &mut self,
        mut eval: Eval,
        tags: &[&str],
        id: Id,
        objects: Vec<String>,
        role: &str,
    ) -> Result<Eval, Fault> {
        if tags
            .iter()
            .any(|t| self.watch.contains(*t) || *t == "input.source")
        {
            self.emit(id, "nop", vec![])?;
            eval.deps
                .extend(self.evidence(tags, id, objects, &eval.value, role));
        }
        Ok(eval)
    }
    pub fn current_frame(&self) -> Option<String> {
        self.activations.last().map(|a| a.frame.clone())
    }
    pub fn env(&self) -> &Environment {
        if let Some(a) = self.activations.last() {
            a.env.last().expect("active function scope")
        } else {
            self.global.as_ref().expect("global scope")
        }
    }
    pub fn env_mut(&mut self) -> &mut Environment {
        if let Some(a) = self.activations.last_mut() {
            a.env.last_mut().expect("active function scope")
        } else {
            self.global.as_mut().expect("global scope")
        }
    }
    pub fn scope_index(&self, id: &str) -> usize {
        self.journal.state["scopes"]
            .as_array()
            .unwrap()
            .iter()
            .position(|s| s["id"] == id)
            .expect("scope exists")
    }
    pub fn frame_index(&self, id: &str) -> usize {
        self.journal.state["frames"]
            .as_array()
            .unwrap()
            .iter()
            .position(|s| s["id"] == id)
            .expect("frame exists")
    }
    pub fn scope_enter(&mut self, id: Id) -> Result<(), Fault> {
        let state = &self.journal.state;
        let mut allocator = state["allocator"].clone();
        let scope = format!("s{}", allocator["nextScope"].as_u64().unwrap());
        allocator["nextScope"] = json!(allocator["nextScope"].as_u64().unwrap() + 1);
        let frame = self.current_frame();
        let mut changes = vec![
            state::record(
                "scopes",
                state["scopes"].as_array().unwrap().len(),
                Value::Null,
                json!({"id":scope,"frameId":frame,"nodeId":state::nid(id),"objectIds":[],"aliases":[]}),
            ),
            state::singleton(state, "allocator", allocator),
        ];
        if let Some(frame) = &frame {
            let at = self.frame_index(frame);
            let before = state["frames"][at].clone();
            let mut after = before.clone();
            after["scopeIds"].as_array_mut().unwrap().push(json!(scope));
            changes.push(state::record("frames", at, before, after));
        }
        self.emit(id, "scope.enter", changes)?;
        let env = Environment {
            scope,
            bindings: BTreeMap::new(),
        };
        if let Some(a) = self.activations.last_mut() {
            a.env.push(env)
        } else {
            self.global = Some(env)
        }
        Ok(())
    }
    pub fn scope_exit(&mut self, id: Id) -> Result<(), Fault> {
        let scope = self.env().scope.clone();
        let state = &self.journal.state;
        let at = self.scope_index(&scope);
        let before = state["scopes"][at].clone();
        let mut changes = vec![];
        let mut allocator = state["allocator"].clone();
        for oid in before["objectIds"].as_array().unwrap() {
            let index = oid.as_str().unwrap()[1..].parse::<usize>().unwrap() - 1;
            let object = state["objects"][index].clone();
            if object["storage"] != "automatic" {
                continue;
            }
            let mut after = object.clone();
            after["alive"] = json!(false);
            allocator["liveBytes"] = json!(
                allocator["liveBytes"].as_u64().unwrap() - object["byteLength"].as_u64().unwrap()
            );
            changes.push(state::record("objects", index, object, after));
        }
        changes.push(state::record("scopes", at, before.clone(), Value::Null));
        changes.push(state::singleton(state, "allocator", allocator));
        if let Some(frame) = self.current_frame() {
            let at = self.frame_index(&frame);
            let before = state["frames"][at].clone();
            let mut after = before.clone();
            let last = after["scopeIds"].as_array_mut().unwrap().pop().unwrap();
            assert_eq!(last, scope);
            changes.push(state::record("frames", at, before, after));
        }
        let ended = before["objectIds"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|o| o.as_str())
            .map(|o| o[1..].parse::<usize>().unwrap() - 1)
            .filter(|o| self.journal.state["objects"][*o]["storage"] == "automatic")
            .collect::<Vec<_>>();
        self.emit(id, "scope.exit", changes)?;
        for object in ended {
            self.objects[object].ended_at = Some(self.journal.steps.len());
        }
        if let Some(a) = self.activations.last_mut() {
            a.env.pop();
        } else {
            self.global = None
        }
        Ok(())
    }
    pub fn bind(&mut self, name: &str, object: usize, id: Id, alias: bool) -> Result<(), Fault> {
        let scope = self.env().scope.clone();
        let at = self.scope_index(&scope);
        let before = self.journal.state["scopes"][at].clone();
        let mut after = before.clone();
        let oid = self.journal.state["objects"][object]["id"].clone();
        if alias && self.journal.state["objects"][object]["name"] != name {
            after["aliases"]
                .as_array_mut()
                .unwrap()
                .push(json!({"name":name,"objectId":oid}));
        } else {
            after["objectIds"].as_array_mut().unwrap().push(oid);
        }
        self.emit(id, "nop", vec![state::record("scopes", at, before, after)])?;
        self.env_mut().bindings.insert(name.into(), object);
        Ok(())
    }
    pub fn allocate(
        &mut self,
        ty: Ty,
        name: &str,
        id: Id,
        policy: Allocation,
    ) -> Result<usize, Fault> {
        let Allocation {
            storage,
            zero,
            writable,
            parameter,
        } = policy;
        let state = &self.journal.state;
        let mut allocator = state["allocator"].clone();
        let bytes = self.checked.types.size(&ty);
        let alignment = self.checked.types.alignment(&ty);
        if bytes == 0
            || allocator["liveBytes"].as_u64().unwrap() as usize + bytes
                > self.meter.limits().live_bytes
        {
            return Err(self.err("E_MEMORY_LIMIT", id));
        }
        let index = state["objects"].as_array().unwrap().len();
        let object_id = format!("o{}", index + 1);
        let base =
            (allocator["nextAddress"].as_u64().unwrap() as usize).div_ceil(alignment) * alignment;
        allocator["nextAddress"] = json!(base + bytes);
        allocator["nextObject"] = json!(index + 2);
        allocator["liveBytes"] = json!(allocator["liveBytes"].as_u64().unwrap() + bytes as u64);
        let automatic = storage == "automatic";
        let object = json!({"id":object_id,"declarationNodeId":state::nid(id),"frameId":if automatic{self.current_frame()}else{None},
         "scopeId":if automatic{Some(self.env().scope.clone())}else{None},"name":name,"typeName":ty.name(),"length":match ty.bare(){Ty::Array(_,n)=>*n,_=>1},"byteLength":bytes,"baseAddress":base,
         "storage":storage,"alive":true,"zeroInitialized":zero,"cells":[],"writable":writable});
        let mut changes = vec![
            state::record("objects", index, Value::Null, object),
            state::singleton(state, "allocator", allocator),
        ];
        if automatic {
            let at = self.scope_index(&self.env().scope);
            let before = state["scopes"][at].clone();
            let mut after = before.clone();
            after["objectIds"]
                .as_array_mut()
                .unwrap()
                .push(json!(object_id));
            changes.push(state::record("scopes", at, before, after));
        }
        self.emit(
            id,
            if storage == "static" {
                "c6.static.initialize"
            } else {
                "object.declare"
            },
            changes,
        )?;
        let tags = if zero && matches!(ty.bare(),Ty::Array(base,_)if base.bare()==&Ty::Int) {
            vec!["array.initialize"]
        } else {
            vec![]
        };
        let declaration_deps =
            self.evidence(&tags, id, vec![object_id], &Val::I(0), &index.to_string());
        let static_local = matches!(&self.checked.program.nodes[id].kind,crate::syntax::Kind::Declare(d)if d.static_storage&&!d.global);
        self.objects.push(ObjectMeta {
            ty,
            declaration: id,
            parameter,
            static_local,
            ended_at: None,
            initialized: zero,
            declaration_deps,
        });
        Ok(index)
    }
    pub fn lookup(&self, name: &str, id: Id) -> Result<usize, Fault> {
        if let Some(a) = self.activations.last()
            && let Some(object) = a.env.iter().rev().find_map(|e| e.bindings.get(name))
        {
            return Ok(*object);
        }
        self.global
            .as_ref()
            .and_then(|e| e.bindings.get(name))
            .copied()
            .ok_or_else(|| self.err("E_UNDECLARED", id))
    }
    pub fn object_place(&self, object: usize) -> Place {
        Place {
            object,
            offset: 0,
            ty: self.objects[object].ty.clone(),
            lower: 0,
            upper: self.journal.state["objects"][object]["byteLength"]
                .as_u64()
                .unwrap() as usize,
            pointer: false,
            explicit_deref: false,
            deps: Deps::new(),
            access: Access::default(),
        }
    }
    pub fn validate(
        &self,
        p: &Place,
        write: bool,
        initialization: bool,
        id: Id,
    ) -> Result<(), Fault> {
        let object = self.journal.state["objects"]
            .as_array()
            .and_then(|a| a.get(p.object))
            .ok_or_else(|| self.err("E_POINTER_BOUNDS", id))?;
        if object["alive"] != true {
            return Err(self.err("E_DANGLING_POINTER", id));
        }
        let size = self.checked.types.size(&p.ty);
        let length = object["byteLength"].as_u64().unwrap() as usize;
        if p.lower > p.offset
            || p.offset.checked_add(size).is_none_or(|end| end > p.upper)
            || p.upper > length
            || !p.offset.is_multiple_of(self.checked.types.alignment(&p.ty))
        {
            return Err(self.err(
                if p.pointer {
                    "E_POINTER_BOUNDS"
                } else {
                    "E_BOUNDS"
                },
                id,
            ));
        }
        if write && !initialization && (object["writable"] != true || p.ty.top_const()) {
            return Err(self.err(
                if object["storage"] == "literal" {
                    "E_READONLY"
                } else {
                    "E_CONST_WRITE"
                },
                id,
            ));
        }
        Ok(())
    }
    pub fn pointer_place(&self, eval: &Eval, id: Id) -> Result<Place, Fault> {
        let Val::P(pointer) = &eval.value else {
            return Err(self.err("E_TYPE_INVALID", id));
        };
        let Some(oid) = &pointer.object_id else {
            return Err(self.err("E_NULL_POINTER", id));
        };
        let object = oid
            .strip_prefix('o')
            .and_then(|n| n.parse::<usize>().ok())
            .and_then(|n| n.checked_sub(1))
            .filter(|n| *n < self.objects.len())
            .ok_or_else(|| self.err("E_POINTER_BOUNDS", id))?;
        let Ty::Pointer(ty) = eval.ty.bare() else {
            return Err(self.err("E_TYPE_INVALID", id));
        };
        Ok(Place {
            object,
            offset: pointer.byte_offset,
            ty: ty.as_ref().clone(),
            lower: pointer.lower_bound,
            upper: pointer.upper_bound,
            pointer: true,
            explicit_deref: false,
            deps: eval.deps.clone(),
            access: eval.access.clone(),
        })
    }
    pub fn read(&mut self, p: Place, id: Id) -> Result<Eval, Fault> {
        self.tick(id, 1)?;
        self.validate(&p, false, false, id)?;
        let object = &self.journal.state["objects"][p.object];
        if let Ty::Array(element, _) = p.ty.bare() {
            let t = if p.ty.top_const() {
                Ty::Const(element.clone())
            } else {
                element.as_ref().clone()
            };
            return Ok(Eval {
                value: Val::P(types::Pointer {
                    object_id: Some(object["id"].as_str().unwrap().into()),
                    byte_offset: p.offset,
                    lower_bound: p.offset,
                    upper_bound: p.offset + self.checked.types.size(&p.ty),
                    pointee_type: t.name(),
                }),
                ty: Ty::Pointer(Box::new(t)),
                deps: p.deps,
                constant: false,
                access: p.access,
            });
        }
        if !p.ty.scalar() {
            return Err(self.err("E_TYPE_INVALID", id));
        }
        let wire =
            state::cell(object, p.offset, &self.checked.types).map_err(|c| self.err(c, id))?;
        if wire.is_null() {
            return Err(self.err("E_UNINITIALIZED", id));
        }
        let value = Val::from_wire(&wire, &p.ty).map_err(|c| self.err(c, id))?;
        let mut deps = p.deps.clone();
        deps.extend(self.objects[p.object].declaration_deps.clone());
        if let Some(cell) = self.cell_deps.get(&(p.object, p.offset)) {
            deps.extend(cell.clone())
        }
        let mut tags = vec![];
        if self.objects[p.object].parameter {
            tags.push("function.parameter");
            if matches!(p.ty.bare(), Ty::Pointer(_)) {
                tags.extend(["array.pointer-parameter", "pointer.parameter-write"]);
            }
        }
        match p.ty.bare() {
            Ty::Int => tags.push("type.int32"),
            Ty::UInt => tags.push("type.uint32"),
            Ty::Char => tags.extend(["type.ascii-char", "char.promotion"]),
            Ty::F32 | Ty::F64 => tags.extend(["type.f32-f64", "float.typed"]),
            _ => {}
        }
        if value == Val::C(0) {
            tags.push("string.nul")
        }
        if matches!(value, Val::C(_)) && self.watch.contains("string.copy") {
            tags.push("string.char-source")
        }
        if p.ty.name().starts_with("enum ") {
            tags.push("type.enum")
        }
        if object["storage"] == "static" {
            tags.push("static.lifetime");
            if self.objects[p.object].static_local {
                tags.push("storage.static-local")
            }
        }
        if object["storage"] == "automatic" {
            tags.extend(["scope.lifetime", "storage.automatic"])
        }
        if matches!(self.objects[p.object].ty.bare(),Ty::Array(base,_)if base.bare()==&Ty::Int) {
            tags.push("array.read-contribution")
        }
        let oid = object["id"].as_str().unwrap().to_string();
        let mut access = p.access.clone();
        access.reads.insert((p.object, p.offset));
        let eval = Eval {
            value,
            ty: p.ty.clone(),
            constant: self
                .cell_constants
                .get(&(p.object, p.offset))
                .copied()
                .unwrap_or(true)
                && !deps.values().any(|proof| proof.tag == "input.source"),
            deps,
            access,
        };
        let eval = self.attach(
            eval,
            &tags,
            id,
            vec![oid],
            &format!("{}:{}:{}", p.object, p.offset, p.ty.name()),
        )?;
        self.accesses.push(MemoryAccess {
            object: p.object,
            offset: p.offset,
            write: false,
            initialization: false,
            node: id,
            seq: self.journal.steps.len(),
        });
        Ok(eval)
    }
    pub fn writes(
        &mut self,
        updates: Vec<(Place, Eval)>,
        id: Id,
        initialization: bool,
        extra: Vec<Value>,
        kind: &str,
    ) -> Result<Vec<Eval>, Fault> {
        let mut changes = vec![];
        let mut counters = self.journal.state["counters"].clone();
        let mut pending = vec![];
        for (p, value) in updates {
            self.tick(id, 1)?;
            self.validate(&p, true, initialization, id)?;
            let mut value = value.cast(&p.ty).map_err(|c| self.err(c, id))?;
            let copy_source = if p.ty.bare() == &Ty::Char && kind == "value.write" {
                value
                    .deps
                    .values()
                    .find(|proof| {
                        proof.tag == "string.char-source"
                            && proof.value == value.value.wire()
                            && proof
                                .object_ids
                                .first()
                                .is_some_and(|oid| *oid != format!("o{}", p.object + 1))
                    })
                    .and_then(|p| p.object_ids.first())
                    .cloned()
            } else {
                None
            };
            value.deps.extend(self.control_deps.clone());
            value.deps.extend(self.call_deps.clone());
            value.deps.extend(p.deps.clone());
            value.constant &= !value.deps.values().any(|proof| proof.tag == "input.source");
            let object = &self.journal.state["objects"][p.object];
            let before =
                state::cell(object, p.offset, &self.checked.types).map_err(|c| self.err(c, id))?;
            changes.push(json!({"op":"cell","objectId":object["id"],"byteOffset":p.offset,"before":before,"after":value.value.wire()}));
            let counter = if matches!(self.objects[p.object].ty.bare(), Ty::Array(..)) {
                "arrayWrites"
            } else {
                "scalarWrites"
            };
            counters[counter] = json!(counters[counter].as_u64().unwrap() + 1);
            pending.push((p, value, copy_source, before));
        }
        changes.push(state::singleton(&self.journal.state, "counters", counters));
        changes.extend(extra);
        self.emit(id, kind, changes)?;
        let mut out = vec![];
        for (p, mut value, copy_source, before) in pending {
            let oid = self.journal.state["objects"][p.object]["id"]
                .as_str()
                .unwrap()
                .to_string();
            let mut tags = vec![];
            if kind == "value.write"
                && !initialization
                && (self.watch.contains("pointer.write-contribution")
                    || self.watch.contains("array.write-contribution")
                    || self.watch.contains("storage.static-local")
                    || self.watch.contains("goal.write"))
            {
                self.user_writes.push(UserWrite {
                    object: p.object,
                    offset: p.offset,
                    node: id,
                    seq: self.journal.steps.len(),
                    pointer: p.pointer,
                    frame_id: self.current_frame(),
                    before,
                    after: value.value.wire(),
                    loop_node: self
                        .control_deps
                        .values()
                        .find(|p| p.tag == "loop.contribution")
                        .map(|p| p.node_id.clone()),
                });
                tags.push("goal.write");
            }
            if p.pointer && !initialization && kind == "value.write" {
                tags.push("pointer.write-contribution");
                if p.explicit_deref {
                    tags.push("pointer.dereference")
                }
            }
            if matches!(self.objects[p.object].ty.bare(),Ty::Array(base,_)if base.bare()==&Ty::Int)
                && !initialization
                && kind == "value.write"
            {
                tags.extend(["array.write-contribution", "array.write"])
            }
            if initialization && matches!(self.objects[p.object].ty.bare(), Ty::Struct(_)) {
                tags.push("struct.initialize")
            }
            value.deps.extend(self.evidence(
                &tags,
                id,
                vec![oid],
                &value.value,
                &format!("{}:{}:{id}", p.object, p.offset),
            ));
            if let Some(source) = copy_source {
                value.deps.extend(self.evidence(
                    &["string.copy"],
                    id,
                    vec![format!("o{}", p.object + 1), source],
                    &value.value,
                    &format!("{}:{}", p.object, p.offset),
                ));
            }
            value.access.merge(&p.access);
            value.access.writes.insert((p.object, p.offset));
            self.cell_deps
                .insert((p.object, p.offset), value.deps.clone());
            self.cell_constants
                .insert((p.object, p.offset), value.constant);
            self.objects[p.object].initialized |= initialization;
            self.accesses.push(MemoryAccess {
                object: p.object,
                offset: p.offset,
                write: true,
                initialization,
                node: id,
                seq: self.journal.steps.len(),
            });
            out.push(value);
        }
        Ok(out)
    }
}
