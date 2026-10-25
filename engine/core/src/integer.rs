//! P0-C's checked int32 value rules, without traversing or executing an AST.
//!
//! These primitives accept values already obtained by a caller. In particular,
//! a future evaluator must consult `short_circuit` before evaluating a logical
//! operator's right operand. Static semantic checking does not evaluate values
//! with these functions or turn runtime errors into unconditional diagnostics.

use crate::ast::{BinaryOp, UnaryOp};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntError {
    DivideByZero,
    Overflow,
}

/// P0-C conditions are false only for zero, across the entire int32 domain.
pub fn truth(value: i32) -> bool {
    value != 0
}

pub fn unary(op: UnaryOp, value: i32) -> Result<i32, IntError> {
    match op {
        UnaryOp::Plus => Ok(value),
        UnaryOp::Minus => value.checked_neg().ok_or(IntError::Overflow),
        UnaryOp::Not => Ok(i32::from(!truth(value))),
    }
}

/// Apply an operator to two supplied values, checking every arithmetic result.
///
/// Division truncates toward zero. Remainders have the dividend's sign when
/// nonzero. Both MIN / -1 and MIN % -1 overflow, including the latter's zero
/// mathematical remainder. A zero divisor is diagnosed before division/rem.
/// Logical and comparison results are always zero or one. This function does
/// not decide whether a caller should obtain the right operand at all.
pub fn binary(op: BinaryOp, left: i32, right: i32) -> Result<i32, IntError> {
    match op {
        BinaryOp::Multiply => left.checked_mul(right).ok_or(IntError::Overflow),
        BinaryOp::Divide | BinaryOp::Remainder => {
            if right == 0 {
                return Err(IntError::DivideByZero);
            }
            let result = if op == BinaryOp::Divide {
                left.checked_div(right)
            } else {
                left.checked_rem(right)
            };
            result.ok_or(IntError::Overflow)
        }
        BinaryOp::Add => left.checked_add(right).ok_or(IntError::Overflow),
        BinaryOp::Subtract => left.checked_sub(right).ok_or(IntError::Overflow),
        BinaryOp::Less => Ok(i32::from(left < right)),
        BinaryOp::LessEqual => Ok(i32::from(left <= right)),
        BinaryOp::Greater => Ok(i32::from(left > right)),
        BinaryOp::GreaterEqual => Ok(i32::from(left >= right)),
        BinaryOp::Equal => Ok(i32::from(left == right)),
        BinaryOp::NotEqual => Ok(i32::from(left != right)),
        BinaryOp::And => Ok(i32::from(truth(left) && truth(right))),
        BinaryOp::Or => Ok(i32::from(truth(left) || truth(right))),
    }
}

/// Return the final logical result when the right operand must be skipped.
///
/// `None` means this operator/left value supplies no short-circuit result.
/// No right value, callback, AST or state is accepted or touched here.
pub fn short_circuit(op: BinaryOp, left: i32) -> Option<i32> {
    match op {
        BinaryOp::And if !truth(left) => Some(0),
        BinaryOp::Or if truth(left) => Some(1),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{IntError, binary, short_circuit, truth, unary};
    use crate::ast::{BinaryOp, UnaryOp};

    #[test]
    fn arithmetic_boundary_table_never_wraps_or_saturates() {
        for (op, left, right, expected) in [
            (BinaryOp::Add, i32::MAX, 0, Ok(i32::MAX)),
            (BinaryOp::Add, i32::MAX, 1, Err(IntError::Overflow)),
            (BinaryOp::Add, i32::MIN, -1, Err(IntError::Overflow)),
            (BinaryOp::Subtract, i32::MIN, 0, Ok(i32::MIN)),
            (BinaryOp::Subtract, i32::MIN, 1, Err(IntError::Overflow)),
            (BinaryOp::Subtract, i32::MAX, -1, Err(IntError::Overflow)),
            (BinaryOp::Subtract, i32::MIN, i32::MIN, Ok(0)),
            (BinaryOp::Multiply, i32::MIN, 1, Ok(i32::MIN)),
            (BinaryOp::Multiply, i32::MIN, 0, Ok(0)),
            (BinaryOp::Multiply, i32::MIN, -1, Err(IntError::Overflow)),
            (BinaryOp::Multiply, 46_340, 46_340, Ok(2_147_395_600)),
            (BinaryOp::Multiply, 46_341, 46_341, Err(IntError::Overflow)),
            (BinaryOp::Divide, i32::MIN, -1, Err(IntError::Overflow)),
            (BinaryOp::Remainder, i32::MIN, -1, Err(IntError::Overflow)),
            (BinaryOp::Divide, i32::MIN, 1, Ok(i32::MIN)),
            (BinaryOp::Remainder, i32::MIN, 1, Ok(0)),
        ] {
            assert_eq!(binary(op, left, right), expected, "{left} {op:?} {right}");
        }
    }

    #[test]
    fn signed_division_and_remainder_follow_truncation_toward_zero() {
        for (left, right, quotient, remainder) in [
            (-7, 3, -2, -1),
            (7, -3, -2, 1),
            (-7, -3, 2, -1),
            (7, 3, 2, 1),
            (-1, 2, 0, -1),
            (1, -2, 0, 1),
            (0, -3, 0, 0),
            (i32::MIN, 3, -715_827_882, -2),
            (i32::MAX, -3, -715_827_882, 1),
        ] {
            assert_eq!(binary(BinaryOp::Divide, left, right), Ok(quotient));
            assert_eq!(binary(BinaryOp::Remainder, left, right), Ok(remainder));
            assert_eq!(
                i64::from(left),
                i64::from(quotient) * i64::from(right) + i64::from(remainder)
            );
        }
        for left in [i32::MIN, -1, 0, 1, i32::MAX] {
            for op in [BinaryOp::Divide, BinaryOp::Remainder] {
                assert_eq!(binary(op, left, 0), Err(IntError::DivideByZero));
            }
        }
    }

    // Independent wide-integer oracle: calculate the mathematical result in
    // i64, then enforce int32 representability. The quotient itself must be
    // representable for remainder too, as required by the P0-C MIN/-1 rule.
    fn arithmetic_oracle(op: BinaryOp, left: i32, right: i32) -> Result<i32, IntError> {
        let left = i64::from(left);
        let right = i64::from(right);
        let result = match op {
            BinaryOp::Add => left + right,
            BinaryOp::Subtract => left - right,
            BinaryOp::Multiply => left * right,
            BinaryOp::Divide | BinaryOp::Remainder => {
                if right == 0 {
                    return Err(IntError::DivideByZero);
                }
                let quotient = left / right;
                i32::try_from(quotient).map_err(|_| IntError::Overflow)?;
                if op == BinaryOp::Divide {
                    quotient
                } else {
                    left - quotient * right
                }
            }
            _ => panic!("arithmetic-only oracle"),
        };
        i32::try_from(result).map_err(|_| IntError::Overflow)
    }

    #[test]
    fn checked_arithmetic_matches_wide_mathematics_for_boundary_pairs_and_samples() {
        let boundary = [
            i32::MIN,
            i32::MIN + 1,
            -65_536,
            -46_341,
            -999,
            -2,
            -1,
            0,
            1,
            2,
            999,
            46_341,
            65_536,
            i32::MAX - 1,
            i32::MAX,
        ];
        let operations = [
            BinaryOp::Add,
            BinaryOp::Subtract,
            BinaryOp::Multiply,
            BinaryOp::Divide,
            BinaryOp::Remainder,
        ];
        for left in boundary {
            for right in boundary {
                for op in operations {
                    assert_eq!(binary(op, left, right), arithmetic_oracle(op, left, right));
                }
            }
        }
        // Wrapping is used only to generate reproducible test bit patterns,
        // never to evaluate a P0-C arithmetic operation.
        let mut pattern = 0x0503_cafe_u32;
        for _ in 0..5_000 {
            pattern = pattern.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let left = i32::from_ne_bytes(pattern.to_ne_bytes());
            pattern = pattern.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let right = i32::from_ne_bytes(pattern.to_ne_bytes());
            for op in operations {
                assert_eq!(binary(op, left, right), arithmetic_oracle(op, left, right));
            }
        }
    }

    #[test]
    fn unary_operations_keep_int32_boundaries_and_normalize_not() {
        for value in [i32::MIN, i32::MIN + 1, -999, -1, 0, 1, 999, i32::MAX] {
            assert_eq!(unary(UnaryOp::Plus, value), Ok(value));
            assert_eq!(
                unary(UnaryOp::Minus, value),
                i32::try_from(-i64::from(value)).map_err(|_| IntError::Overflow)
            );
            assert_eq!(
                unary(UnaryOp::Not, value),
                Ok(if value == 0 { 1 } else { 0 })
            );
            assert_eq!(truth(value), value != 0);
        }
    }

    #[test]
    fn comparisons_and_logic_produce_only_zero_or_one() {
        let values = [i32::MIN, -999, -1, 0, 1, 999, i32::MAX];
        for left in values {
            for right in values {
                for (op, expected) in [
                    (BinaryOp::Less, left < right),
                    (BinaryOp::LessEqual, left <= right),
                    (BinaryOp::Greater, left > right),
                    (BinaryOp::GreaterEqual, left >= right),
                    (BinaryOp::Equal, left == right),
                    (BinaryOp::NotEqual, left != right),
                    (BinaryOp::And, left != 0 && right != 0),
                    (BinaryOp::Or, left != 0 || right != 0),
                ] {
                    assert_eq!(binary(op, left, right), Ok(if expected { 1 } else { 0 }));
                }
            }
        }
    }

    #[test]
    fn short_circuit_selection_needs_no_right_operand() {
        for left in [i32::MIN, -999, -1, 0, 1, 999, i32::MAX] {
            assert_eq!(
                short_circuit(BinaryOp::And, left),
                if left == 0 { Some(0) } else { None }
            );
            assert_eq!(
                short_circuit(BinaryOp::Or, left),
                if left != 0 { Some(1) } else { None }
            );
            for op in [
                BinaryOp::Multiply,
                BinaryOp::Divide,
                BinaryOp::Remainder,
                BinaryOp::Add,
                BinaryOp::Subtract,
                BinaryOp::Less,
                BinaryOp::LessEqual,
                BinaryOp::Greater,
                BinaryOp::GreaterEqual,
                BinaryOp::Equal,
                BinaryOp::NotEqual,
            ] {
                assert_eq!(short_circuit(op, left), None);
            }
        }
    }
}
