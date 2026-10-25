//! Frozen pre-typed-shell delta body; only the function name/visibility is changed.
use super::*;

pub(super) fn legacy_delta(
    before: &RuntimeState,
    after: &RuntimeState,
    old: &Value,
    new: &Value,
    write: Option<(String, usize)>,
    meter: &mut Meter,
) -> Result<Vec<Value>, Diagnostic> {
    charge(
        meter,
        before.scopes.len()
            + after.scopes.len()
            + before.variables.len()
            + before.arrays.len()
            + after.variables.len()
            + after.arrays.len(),
    )?;
    let mut changes = Vec::new();
    for table in ["frames", "scopes"] {
        let old = old[table].as_array().expect("shell table");
        let new = new[table].as_array().expect("shell table");
        let common = old.len().min(new.len());
        for i in 0..common {
            charge(meter, 1)?;
            assert_eq!(old[i]["id"], new[i]["id"], "stack table identity");
            if old[i] != new[i] {
                changes.push(object_value([
                    ("op", "record".into()),
                    ("table", table.into()),
                    ("id", new[i]["id"].clone()),
                    ("index", i.into()),
                    ("before", old[i].clone()),
                    ("after", new[i].clone()),
                ]));
            }
        }
        for i in (common..old.len()).rev() {
            charge(meter, 1)?;
            changes.push(object_value([
                ("op", "record".into()),
                ("table", table.into()),
                ("id", old[i]["id"].clone()),
                ("index", i.into()),
                ("before", old[i].clone()),
                ("after", Value::Null),
            ]));
        }
        for (i, r) in new.iter().enumerate().skip(common) {
            charge(meter, 1)?;
            changes.push(object_value([
                ("op", "record".into()),
                ("table", table.into()),
                ("id", r["id"].clone()),
                ("index", i.into()),
                ("before", Value::Null),
                ("after", r.clone()),
            ]));
        }
    }
    let old_objects = objects(before);
    let new_objects = objects(after);
    let common = old_objects.len().min(new_objects.len());
    for (i, o) in old_objects.iter().enumerate().skip(common).rev() {
        charge(meter, 1 + o.cells() + o.name_bytes().div_ceil(64))?;
        changes.push(object_value([
            ("op", "record".into()),
            ("table", "objects".into()),
            ("id", format!("o{}", o.id()).into()),
            ("index", i.into()),
            ("before", o.json()),
            ("after", Value::Null),
        ]));
    }
    for (i, n) in new_objects.iter().enumerate() {
        charge(meter, 1)?;
        match old_objects.get(i) {
            None => {
                charge(meter, n.cells() + n.name_bytes().div_ceil(64))?;
                changes.push(object_value([
                    ("op", "record".into()),
                    ("table", "objects".into()),
                    ("id", format!("o{}", n.id()).into()),
                    ("index", i.into()),
                    ("before", Value::Null),
                    ("after", n.json()),
                ]));
            }
            Some(o) if o.default() != n.default() => {
                assert_eq!(o.id(), n.id());
                charge(
                    meter,
                    o.cells() + n.cells() + (o.name_bytes() + n.name_bytes()).div_ceil(64),
                )?;
                changes.push(object_value([
                    ("op", "record".into()),
                    ("table", "objects".into()),
                    ("id", format!("o{}", n.id()).into()),
                    ("index", i.into()),
                    ("before", o.json()),
                    ("after", n.json()),
                ]));
            }
            Some(o) => {
                if let Some((id, index)) = &write
                    && object_id_matches(id, n.id())
                {
                    assert!(*index < n.length());
                    changes.push(object_value([
                        ("op", "cell".into()),
                        ("objectId", id.clone().into()),
                        ("index", (*index).into()),
                        ("before", o.value(*index).map_or(Value::Null, Value::from)),
                        ("after", n.value(*index).map_or(Value::Null, Value::from)),
                    ]));
                }
            }
        }
    }
    for key in ["control", "allocator", "counters"] {
        charge(meter, 1)?;
        if old[key] != new[key] {
            changes.push(object_value([
                ("op", key.into()),
                ("before", old[key].clone()),
                ("after", new[key].clone()),
            ]));
        }
    }
    if before.output.len() != after.output.len() {
        charge(
            meter,
            (after.output.len() - before.output.len()).div_ceil(64),
        )?;
        changes.push(object_value([
            ("op", "output".into()),
            ("beforeBytes", before.output.len().into()),
            ("afterBytes", after.output.len().into()),
            ("append", after.output[before.output.len()..].into()),
        ]));
    }
    Ok(changes)
}

#[test]
fn typed_delta_matches_frozen_body_bytes_fuel_and_control_events() {
    use crate::budget::{BudgetError, FINALIZATION_RESERVE, Limits};
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    type Observation = (
        Result<Vec<Value>, Diagnostic>,
        usize,
        usize,
        Option<BudgetError>,
        Vec<char>,
    );
    let observe = |case: &delta_differential_tests::Case,
                   typed: bool,
                   fuel: usize,
                   prefix: usize,
                   cancel_at: Option<usize>,
                   deadline_at: Option<usize>|
     -> Observation {
        let events = Rc::new(RefCell::new(Vec::new()));
        let clocks = Rc::new(Cell::new(0));
        let cancels = Rc::new(Cell::new(0));
        let mut meter = Meter::with_limits(Limits {
            fuel,
            ..Limits::default()
        });
        let clock_events = events.clone();
        let clock_reads = clocks.clone();
        meter.set_clock(
            1000,
            Box::new(move || {
                clock_events.borrow_mut().push('t');
                let read = clock_reads.get() + 1;
                clock_reads.set(read);
                if deadline_at.is_some_and(|at| read >= at) {
                    1000
                } else {
                    0
                }
            }),
        );
        let cancel_events = events.clone();
        let cancel_reads = cancels.clone();
        meter.set_cancel(Box::new(move || {
            cancel_events.borrow_mut().push('c');
            let read = cancel_reads.get() + 1;
            cancel_reads.set(read);
            cancel_at.is_some_and(|at| read >= at)
        }));
        if prefix > 0 {
            let _ = meter.charge(prefix);
        }
        let (before, after, old, new, old_typed, new_typed, write) = case;
        let result = if typed {
            delta(
                before,
                after,
                old_typed,
                new_typed,
                write.clone(),
                &mut meter,
            )
        } else {
            legacy_delta(before, after, old, new, write.clone(), &mut meter)
        };
        let events = events.borrow().clone();
        (
            result,
            meter.used(),
            meter.reserved(),
            meter.failure(),
            events,
        )
    };
    let compare = |case: &delta_differential_tests::Case, fuel, prefix, cancel, deadline| {
        let expected = observe(case, false, fuel, prefix, cancel, deadline);
        let actual = observe(case, true, fuel, prefix, cancel, deadline);
        assert_eq!(actual, expected);
        if let (Ok(current), Ok(original)) = (&actual.0, &expected.0) {
            assert_eq!(
                serde_json::to_vec(current).unwrap(),
                serde_json::to_vec(original).unwrap()
            );
        }
        actual.1
    };
    let cases = delta_differential_tests::cases();
    assert_eq!(cases.len(), 27);
    for case in cases {
        let cost = compare(&case, Limits::default().fuel, 0, None, None);
        for available in 0..=cost + 1 {
            compare(&case, FINALIZATION_RESERVE + available, 0, None, None);
        }
        for prefix in [0, 1023, 1024, 2047] {
            compare(&case, Limits::default().fuel, prefix, None, None);
            for cancel in 1..=4 {
                compare(&case, Limits::default().fuel, prefix, Some(cancel), None);
                for deadline in 2..=5 {
                    compare(
                        &case,
                        Limits::default().fuel,
                        prefix,
                        Some(cancel),
                        Some(deadline),
                    );
                }
            }
            for deadline in 2..=5 {
                compare(&case, Limits::default().fuel, prefix, None, Some(deadline));
            }
        }
    }
}
