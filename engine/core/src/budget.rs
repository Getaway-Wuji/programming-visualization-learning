//! Shared run-wide BUDGET-P0 accounting, including the final result reserve.
//!
//! A meter is never rolled back with a failed C action. It is intentionally
//! independent of browser lifecycle management; a WASM caller supplies its
//! monotonic clock and the remaining time inherited from the original trigger.

use crate::diagnostic::{Diagnostic, DiagnosticCode, DiagnosticDetails, Location, Stage};

pub const FINALIZATION_RESERVE: usize = 4096;
pub const TERMINAL_BYTES: usize = 65_536;
pub const JSON_DEPTH: usize = 32;
const CHECK_INTERVAL: usize = 1024;

/// Private technical observations, never part of EXEC-01 or resource charging.
/// Runtime includes incremental trace encoding; nested phases are inclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(usize)]
pub enum TimingPhase {
    RustTotal,
    CatalogDecode,
    CoreRequest,
    RequestPreflight,
    SourceParse,
    Semantic,
    MetadataEncode,
    NodeMapEncode,
    ExecuteInclusive,
    TraceEncodeAdmission,
    Judge,
    FinalEncode,
}

pub const TIMING_PHASE_COUNT: usize = 12;
/// [version, phase microseconds in enum order, phase call counts in enum
/// order, observer clock reads, invalid observer reads]. All slots are numeric.
pub const TIMING_VECTOR_LEN: usize = 1 + TIMING_PHASE_COUNT * 2 + 2;

struct TimingObserver {
    /// Independent microsecond clock: never invoke the budget clock to observe.
    clock: Box<dyn FnMut() -> f64>,
    micros: [f64; TIMING_PHASE_COUNT],
    calls: [u32; TIMING_PHASE_COUNT],
    reads: u32,
    invalid_reads: u32,
}

impl TimingObserver {
    fn stamp(&mut self) -> Option<f64> {
        self.reads = self.reads.saturating_add(1);
        let now = (self.clock)();
        if now.is_finite() && now >= 0.0 {
            Some(now)
        } else {
            self.invalid_reads = self.invalid_reads.saturating_add(1);
            None
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub source_bytes: usize,
    pub request_bytes: usize,
    pub fuel: usize,
    pub steps: usize,
    pub live_bytes: usize,
    pub output_bytes: usize,
    pub result_bytes: usize,
    pub max_syntax_depth: usize,
    pub max_ast_depth: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            source_bytes: 32_768,
            request_bytes: 65_536,
            fuel: 1_000_000,
            steps: 20_000,
            live_bytes: 1_048_576,
            output_bytes: 16_384,
            result_bytes: 16_777_216,
            max_syntax_depth: 64,
            max_ast_depth: 64,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BudgetError {
    Fuel {
        limit: usize,
        used: usize,
        attempted: usize,
    },
    Deadline {
        limit: usize,
        used: usize,
        attempted: usize,
    },
    Cancelled,
}

impl BudgetError {
    pub fn diagnostic(self, stage: Stage, location: Location) -> Diagnostic {
        let (code, details) = match self {
            Self::Fuel {
                limit,
                used,
                attempted,
            } => (
                DiagnosticCode::FuelLimit,
                DiagnosticDetails {
                    dimension: Some("fuel"),
                    limit: Some(limit),
                    used: Some(used),
                    attempted: Some(attempted as u64),
                    ..Default::default()
                },
            ),
            Self::Deadline {
                limit,
                used,
                attempted,
            } => (
                DiagnosticCode::Deadline,
                DiagnosticDetails {
                    dimension: Some("deadline"),
                    limit: Some(limit),
                    used: Some(used),
                    attempted: Some(attempted as u64),
                    ..Default::default()
                },
            ),
            Self::Cancelled => (DiagnosticCode::Cancelled, DiagnosticDetails::default()),
        };
        Diagnostic {
            code,
            severity: "error",
            origin: if self == Self::Cancelled {
                "adapter"
            } else {
                "rust"
            },
            stage,
            location: if self == Self::Cancelled {
                Location::Synthetic {
                    reason: "adapter-cancel",
                }
            } else {
                location
            },
            details: Box::new(details),
        }
    }
}

pub struct Meter {
    limits: Limits,
    used: usize,
    reserve: usize,
    since_check: usize,
    clock: Option<Box<dyn FnMut() -> u64>>,
    start_ms: u64,
    remaining_ms: u64,
    cancel: Option<Box<dyn FnMut() -> bool>>,
    failure: Option<BudgetError>,
    finalizing: bool,
    observer: Option<TimingObserver>,
}

impl Default for Meter {
    fn default() -> Self {
        Self::new()
    }
}

impl Meter {
    pub fn new() -> Self {
        Self::with_limits(Limits::default())
    }

    /// Explicit internal-test limits. Callers cannot enlarge the frozen limits.
    pub fn with_limits(limits: Limits) -> Self {
        let formal = Limits::default();
        assert!(
            limits.source_bytes <= formal.source_bytes
                && limits.request_bytes <= formal.request_bytes
                && limits.fuel <= formal.fuel
                && limits.steps <= formal.steps
                && limits.live_bytes <= formal.live_bytes
                && limits.output_bytes <= formal.output_bytes
                && limits.result_bytes <= formal.result_bytes
                && limits.max_syntax_depth <= formal.max_syntax_depth
                && limits.max_ast_depth <= formal.max_ast_depth
        );
        let meter = Self {
            limits,
            used: 0,
            reserve: FINALIZATION_RESERVE,
            since_check: CHECK_INTERVAL,
            clock: None,
            start_ms: 0,
            remaining_ms: 1000,
            cancel: None,
            failure: None,
            finalizing: false,
            observer: None,
        };
        #[cfg(not(target_arch = "wasm32"))]
        {
            let mut meter = meter;
            let start = std::time::Instant::now();
            meter.set_clock(
                1000,
                Box::new(move || u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX)),
            );
            meter
        }
        #[cfg(target_arch = "wasm32")]
        meter
    }

    pub fn set_clock(&mut self, remaining_ms: u64, mut clock: Box<dyn FnMut() -> u64>) {
        self.start_ms = clock();
        self.remaining_ms = remaining_ms.min(1000);
        self.clock = Some(clock);
        self.since_check = CHECK_INTERVAL;
    }

    pub fn set_cancel(&mut self, cancel: Box<dyn FnMut() -> bool>) {
        self.cancel = Some(cancel);
        self.since_check = CHECK_INTERVAL;
    }

    /// Optional diagnostics only. Installing or reading it does not sample the
    /// budget clock, cancellation callback or change any accounting state.
    pub fn set_observer_clock(&mut self, clock: Box<dyn FnMut() -> f64>) {
        self.observer = Some(TimingObserver {
            clock,
            micros: [0.0; TIMING_PHASE_COUNT],
            calls: [0; TIMING_PHASE_COUNT],
            reads: 0,
            invalid_reads: 0,
        });
    }

    /// Record an inclusive phase around the exact existing operation. The
    /// closure result (including Err) is returned unchanged. No budget/cancel
    /// check is added, removed, deferred or repeated by observation.
    pub fn measure<T>(&mut self, phase: TimingPhase, work: impl FnOnce(&mut Self) -> T) -> T {
        let start = self.observer.as_mut().and_then(TimingObserver::stamp);
        let result = work(self);
        if let Some(observer) = self.observer.as_mut() {
            let end = observer.stamp();
            if let (Some(start), Some(end)) = (start, end) {
                if end >= start {
                    let index = phase as usize;
                    let elapsed = observer.micros[index] + (end - start);
                    if elapsed.is_finite() {
                        observer.micros[index] = elapsed;
                        observer.calls[index] = observer.calls[index].saturating_add(1);
                    } else {
                        observer.invalid_reads = observer.invalid_reads.saturating_add(1);
                    }
                } else {
                    observer.invalid_reads = observer.invalid_reads.saturating_add(1);
                }
            }
        }
        result
    }

    /// A bounded numeric snapshot contains no source, input, output, identity
    /// or trace. Version zero means observation was not enabled.
    pub fn timing_vector(&self) -> [f64; TIMING_VECTOR_LEN] {
        let mut values = [0.0; TIMING_VECTOR_LEN];
        if let Some(observer) = &self.observer {
            values[0] = 1.0;
            values[1..=TIMING_PHASE_COUNT].copy_from_slice(&observer.micros);
            for (index, calls) in observer.calls.iter().enumerate() {
                values[1 + TIMING_PHASE_COUNT + index] = f64::from(*calls);
            }
            values[TIMING_VECTOR_LEN - 2] = f64::from(observer.reads);
            values[TIMING_VECTOR_LEN - 1] = f64::from(observer.invalid_reads);
        }
        values
    }

    /// Inherit dispatch's remaining time without renewing the entry deadline.
    pub fn shorten_deadline(&mut self, remaining_ms: u64) {
        self.remaining_ms = self.remaining_ms.min(remaining_ms);
        self.since_check = CHECK_INTERVAL;
    }

    /// Measured elapsed time using the same injected monotonic clock. The
    /// clock's millisecond resolution is honestly retained in microseconds.
    pub fn elapsed_micros(&mut self) -> Option<u64> {
        self.clock
            .as_mut()
            .map(|clock| clock().saturating_sub(self.start_ms).saturating_mul(1000))
    }

    pub fn limits(&self) -> &Limits {
        &self.limits
    }
    pub fn used(&self) -> usize {
        self.used
    }
    pub fn reserved(&self) -> usize {
        self.reserve
    }
    pub fn remaining(&self) -> usize {
        self.limits.fuel.saturating_sub(self.used)
    }
    pub fn failure(&self) -> Option<BudgetError> {
        self.failure
    }

    fn stop<T>(&mut self, error: BudgetError) -> Result<T, BudgetError> {
        self.failure = Some(error);
        Err(error)
    }

    fn check_controls(&mut self) -> Result<(), BudgetError> {
        if self.cancel.as_mut().is_some_and(|cancel| cancel()) {
            return self.stop(BudgetError::Cancelled);
        }
        if let Some(clock) = self.clock.as_mut() {
            let elapsed = clock().saturating_sub(self.start_ms);
            if elapsed >= self.remaining_ms {
                return self.stop(BudgetError::Deadline {
                    limit: self.remaining_ms as usize,
                    used: elapsed as usize,
                    attempted: elapsed as usize,
                });
            }
        }
        #[cfg(target_arch = "wasm32")]
        if self.clock.is_none() {
            return self.stop(BudgetError::Deadline {
                limit: 0,
                used: 0,
                attempted: 0,
            });
        }
        self.since_check = 0;
        Ok(())
    }

    pub fn check_commit(&mut self) -> Result<(), BudgetError> {
        if let Some(error) = self.failure {
            return Err(error);
        }
        self.check_controls()
    }

    pub fn charge(&mut self, units: usize) -> Result<(), BudgetError> {
        if let Some(error) = self.failure {
            return Err(error);
        }
        if self.since_check >= CHECK_INTERVAL {
            self.check_controls()?;
        }
        let attempted = self.used.saturating_add(units).saturating_add(self.reserve);
        if attempted > self.limits.fuel {
            return self.stop(BudgetError::Fuel {
                limit: self.limits.fuel,
                used: self.used,
                attempted,
            });
        }
        let mut rest = units;
        while rest > 0 {
            let chunk = rest.min(CHECK_INTERVAL - self.since_check);
            self.used += chunk;
            self.since_check += chunk;
            rest -= chunk;
            if self.since_check == CHECK_INTERVAL {
                self.check_controls()?;
            }
        }
        Ok(())
    }

    /// The estimate includes identity, maps, trace and the terminal byte reserve.
    /// A rejected candidate leaves the preceding committed result's reserve.
    pub fn reserve_result(&mut self, estimated_complete_bytes: usize) -> Result<(), BudgetError> {
        self.check_commit()?;
        let reserve = FINALIZATION_RESERVE.saturating_add(estimated_complete_bytes.div_ceil(64));
        let attempted = self.used.saturating_add(reserve);
        if attempted > self.limits.fuel {
            return self.stop(BudgetError::Fuel {
                limit: self.limits.fuel,
                used: self.used,
                attempted,
            });
        }
        self.reserve = reserve;
        Ok(())
    }

    /// Only fuel/result exhaustion may produce a bounded terminal from reserve.
    /// Cancellation/deadline remain terminal and cannot be unlocked here.
    pub fn begin_finalization(&mut self) -> Result<(), BudgetError> {
        if self.finalizing {
            return self.check_commit();
        }
        if matches!(
            self.failure,
            Some(BudgetError::Cancelled | BudgetError::Deadline { .. })
        ) {
            return Err(self.failure.expect("matched failure"));
        }
        self.check_controls()?;
        self.failure = None;
        self.reserve = 0;
        self.finalizing = true;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, rc::Rc};

    fn deterministic(limits: Limits) -> Meter {
        let mut meter = Meter::with_limits(limits);
        meter.set_clock(1000, Box::new(|| 0));
        meter
    }

    #[test]
    fn exact_fuel_with_reserve_and_final_assembly_is_available() {
        let mut meter = deterministic(Limits {
            fuel: 5000,
            ..Default::default()
        });
        meter.reserve_result(128).unwrap();
        assert_eq!(meter.reserved(), 4098);
        meter.charge(902).unwrap();
        assert!(matches!(meter.charge(1), Err(BudgetError::Fuel { .. })));
        assert_eq!(meter.used(), 902);
        meter.begin_finalization().unwrap();
        meter.charge(4098).unwrap();
        assert_eq!(meter.used(), 5000);
        assert!(meter.charge(1).is_err());
    }

    #[test]
    fn expiry_at_boundary_and_before_commit_is_terminal() {
        let now = Rc::new(Cell::new(0));
        let clock = now.clone();
        let mut meter = Meter::new();
        meter.set_clock(37, Box::new(move || clock.get()));
        meter.charge(3).unwrap();
        now.set(37);
        assert!(matches!(
            meter.check_commit(),
            Err(BudgetError::Deadline { limit: 37, .. })
        ));
        assert!(meter.begin_finalization().is_err());
        assert_eq!(meter.used(), 3);
    }

    #[test]
    fn a_large_charge_checks_at_most_every_1024_units() {
        let checks = Rc::new(Cell::new(0));
        let called = checks.clone();
        let mut meter = Meter::new();
        meter.set_clock(
            1000,
            Box::new(move || {
                called.set(called.get() + 1);
                if called.get() >= 4 { 1000 } else { 0 }
            }),
        );
        assert!(matches!(
            meter.charge(10_000),
            Err(BudgetError::Deadline { .. })
        ));
        assert_eq!(meter.used(), 2048);
    }

    #[test]
    fn cancellation_never_unlocks_for_finalization() {
        let cancelled = Rc::new(Cell::new(false));
        let flag = cancelled.clone();
        let mut meter = deterministic(Limits::default());
        meter.set_cancel(Box::new(move || flag.get()));
        meter.charge(1).unwrap();
        cancelled.set(true);
        assert_eq!(meter.check_commit(), Err(BudgetError::Cancelled));
        assert_eq!(meter.begin_finalization(), Err(BudgetError::Cancelled));
        assert_eq!(meter.charge(0), Err(BudgetError::Cancelled));
    }

    #[test]
    fn reservation_rejection_keeps_last_committed_reserve() {
        let mut meter = deterministic(Limits {
            fuel: 5000,
            ..Default::default()
        });
        meter.reserve_result(64).unwrap();
        meter.charge(900).unwrap();
        assert!(meter.reserve_result(320).is_err());
        assert_eq!(meter.reserved(), 4097);
        meter.begin_finalization().unwrap();
        meter.charge(4097).unwrap();
        assert_eq!(meter.used(), 4997);
    }
}
