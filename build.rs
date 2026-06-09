use std::fs;

fn main() {
    const SCHEMA: &str = "protocol/lightflow_transport.fbs";
    println!("cargo:rerun-if-changed={SCHEMA}");

    let schema = fs::read_to_string(SCHEMA).expect("failed to read FlatBuffers schema");
    for required in [
        "namespace lightflow.transport;",
        "enum MessageKind",
        "table WorkflowRegionRequest",
        "table WorkflowRegionResponse",
        "table WorkflowPatch",
        "table PreviewFrame",
        "table RunEvent",
        "table TransportEnvelope",
        "root_type TransportEnvelope;",
    ] {
        assert!(
            schema.contains(required),
            "FlatBuffers schema is missing `{required}`"
        );
    }
}
