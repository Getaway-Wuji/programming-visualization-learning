use c_viz_c6::{api, budget::Meter, codec};
use serde_json::{Value, json};
#[test]
fn independently_specified_boundary_vectors_execute_in_rust() {
    std::thread::Builder::new().stack_size(8*1024*1024).spawn(||{
        let matrix:Value=serde_json::from_str(include_str!("../../../shared/fixtures/c6/21.3/boundaries.json")).unwrap();let mut failures=vec![];
        for case in matrix["cases"].as_array().unwrap(){
            let source=case["source"].as_str().unwrap();let request=json!({"execVersion":"1.5.0","dslVersion":"1.4.0","diagnosticVersion":"1.4.0","integerEncoding":"1.0.0","language":"c","engineId":"engine.rust.c6","engineVersion":"0.1.0","runId":"matrix","sourceRevision":"revision-1","sourceSha256":api::source_hash(source),"source":source,"input":{"kind":"stdin-ascii","text":case["input"]}});
            let mut meter=Meter::new();let input=codec::encode(&request,&mut meter,65536).unwrap();let result=api::execute(&input,&"a".repeat(64),&mut meter);
            if case["adapterError"]==true{if result.as_ref().err().copied()!=case["code"].as_str(){failures.push(format!("{} adapter {:?}",case["id"],result.err()));}continue}
            let result=match result{Ok(r)=>serde_json::from_slice::<Value>(&r).unwrap(),Err(e)=>{failures.push(format!("{} unexpected adapter {e}",case["id"]));continue}};
            if result["terminal"]["code"]!=case["code"]{failures.push(format!("{} expected {}, actual {}",case["id"],case["code"],result["terminal"]));continue}
            if case["code"].is_null() && result["terminal"]["returnValue"]!=case["returnValue"]{failures.push(format!("{} return {} != {}",case["id"],result["terminal"]["returnValue"],case["returnValue"]));}
            let output=result["trace"]["steps"].as_array().into_iter().flatten().flat_map(|s|s["changes"].as_array().into_iter().flatten()).filter(|c|c["op"]=="output").map(|c|c["append"].as_str().unwrap()).collect::<String>();
            if output!=case["stdout"].as_str().unwrap(){failures.push(format!("{} stdout {:?} != {}",case["id"],output,case["stdout"]));}
            for (name,want)in case["cells"].as_object().unwrap(){
                let cell=result["trace"]["steps"].as_array().unwrap().iter().rev().flat_map(|s|s["changes"].as_array().unwrap()).find(|c|c["op"]=="record"&&c["table"]=="objects"&&c["after"]["name"]==*name).and_then(|c|c["after"]["cells"].as_array()).and_then(|cells|cells.first()).map(|c|&c["value"]);
                let default=if want["bits"]=="00000000"{Some(want)}else{None};
                if cell.or(default)!=Some(want){failures.push(format!("{} cell {name}: {cell:?} != {want}",case["id"]));}
            }
        }
        assert!(failures.is_empty(),"{}",failures.join("\n"));
    }).unwrap().join().unwrap();
}
