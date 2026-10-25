//! 09.1 original full lesson-body examples, read directly from the candidate.
//! No hidden prefix, native user-program execution, or exercise judgement.
use c_viz_core::runtime::{ExecutionOutcome, execute};
use c_viz_core::semantic::analyze;
use serde_json::Value;

#[test]
fn all_eleven_embedded_lesson_programs_match_the_written_outputs_and_runtime_errors() {
    let course: Value =
        serde_json::from_str(include_str!("../../../content/c/p0/course-1.0.1.json")).unwrap();
    let expectations: Value =
        serde_json::from_str(include_str!("../../../content/c/p0/teaching-checks.json")).unwrap();
    let checks = expectations["checks"].as_array().unwrap();
    let mut count = 0;
    let mut errors = 0;
    for lesson in course["lessons"].as_array().unwrap() {
        let explanation = lesson["teaching"]["explanation"].as_str().unwrap();
        for (index, segment) in explanation.split("```c\n").skip(1).enumerate() {
            let (source, _) = segment
                .split_once("\n```")
                .expect("closed complete C fence");
            let expected = &checks[count];
            assert_eq!(expected["lessonId"], lesson["id"]);
            assert_eq!(expected["index"], index);
            let checked = analyze(source).unwrap_or_else(|diagnostic| {
                panic!("{} example {index}: {diagnostic:?}", lesson["id"])
            });
            let execution = execute(&checked);
            assert_eq!(execution.state.output, expected["stdout"].as_str().unwrap());
            if expected["error"].is_null() {
                assert_eq!(
                    execution.outcome,
                    ExecutionOutcome::Completed { exit_code: 0 }
                );
                assert!(execution.state.variables.is_empty());
                assert!(execution.state.arrays.is_empty());
            } else {
                let ExecutionOutcome::ProgramError { diagnostic } = &execution.outcome else {
                    panic!("expected runtime error, got {:?}", execution.outcome);
                };
                let diagnostic = serde_json::to_value(diagnostic).unwrap();
                assert_eq!(diagnostic["code"], expected["error"]);
                assert_eq!(diagnostic["origin"], "rust");
                assert_eq!(diagnostic["stage"], "execute");
                errors += 1;
            }
            count += 1;
        }
    }
    assert_eq!(count, 11);
    assert_eq!(checks.len(), count);
    assert_eq!(errors, 4);
}
