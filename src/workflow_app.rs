use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::mpsc::{self, Receiver, Sender};

use eframe::egui;
use egui::{Color32, RichText, Stroke};
use egui_node_graph2::{
    DataTypeTrait, Graph, GraphEditorState, InputId, InputParamKind, NodeDataTrait, NodeId,
    NodeResponse, NodeTemplateIter, NodeTemplateTrait, OutputId, UserResponseTrait,
    WidgetValueTrait,
};
use petgraph::algo::toposort;
use petgraph::graph::{DiGraph, NodeIndex};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

type EditorState = GraphEditorState<
    WorkflowNodeData,
    WorkflowDataType,
    WorkflowValue,
    WorkflowNodeTemplate,
    UserState,
>;

const BG: Color32 = Color32::from_rgb(6, 10, 18);
const SURFACE: Color32 = Color32::from_rgb(16, 23, 38);
const SURFACE_2: Color32 = Color32::from_rgb(21, 31, 51);
const STROKE: Color32 = Color32::from_rgb(64, 79, 111);
const TEXT: Color32 = Color32::from_rgb(231, 238, 255);
const MUTED: Color32 = Color32::from_rgb(142, 157, 184);
const ACCENT: Color32 = Color32::from_rgb(112, 86, 255);
const ACCENT_2: Color32 = Color32::from_rgb(30, 221, 214);
const GOOD: Color32 = Color32::from_rgb(50, 218, 142);
const WARN: Color32 = Color32::from_rgb(255, 184, 83);

fn muted_text(text: impl Into<String>) -> RichText {
    RichText::new(text).color(MUTED)
}

fn section_title(text: &str) -> RichText {
    RichText::new(text).strong().color(TEXT).size(13.0)
}

fn accent_button(label: &str) -> egui::Button<'_> {
    egui::Button::new(RichText::new(label).strong().color(Color32::WHITE))
        .fill(ACCENT)
        .stroke(Stroke::new(
            1.0,
            Color32::from_rgba_unmultiplied(255, 255, 255, 70),
        ))
        .rounding(egui::Rounding::same(10.0))
}

fn ghost_button(label: &str) -> egui::Button<'_> {
    egui::Button::new(RichText::new(label).color(TEXT))
        .fill(Color32::from_rgba_unmultiplied(255, 255, 255, 16))
        .stroke(Stroke::new(1.0, STROKE))
        .rounding(egui::Rounding::same(10.0))
}

#[cfg(target_arch = "wasm32")]
fn lightflow_step(step: &str) {
    use wasm_bindgen::JsCast;

    let global = js_sys::global();
    if let Ok(reporter) = js_sys::Reflect::get(
        &global,
        &wasm_bindgen::JsValue::from_str("__lightflow_step"),
    ) {
        if let Some(function) = reporter.dyn_ref::<js_sys::Function>() {
            let _ = function.call1(
                &wasm_bindgen::JsValue::NULL,
                &wasm_bindgen::JsValue::from_str(step),
            );
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn lightflow_step(_step: &str) {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResourceSelection {
    McpFile,
    Workflow,
    Tool,
    Resource,
    Prompt,
    RunState,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct WorkflowRegion {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    zoom: f32,
    limit: u32,
    cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct WorkflowPosition {
    x: f32,
    y: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct WorkflowNodeDto {
    id: String,
    kind: String,
    title: String,
    position: WorkflowPosition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    component: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct WorkflowPortRef {
    node: String,
    port: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct WorkflowEdgeDto {
    id: String,
    from: WorkflowPortRef,
    to: WorkflowPortRef,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct WorkflowRegionResponse {
    workflow_id: String,
    revision: String,
    nodes: Vec<WorkflowNodeDto>,
    edges: Vec<WorkflowEdgeDto>,
    total_estimate: Option<u64>,
    next_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct McpResource {
    name: String,
    uri: String,
}

impl McpResource {
    fn label(&self) -> String {
        if self.name == self.uri {
            self.uri.clone()
        } else {
            format!("{} · {}", self.name, self.uri)
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct McpPrompt {
    name: String,
    description: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct WorkflowPatch {
    workflow_id: String,
    base_revision: String,
    ops: Vec<WorkflowPatchOp>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum WorkflowPatchOp {
    AddNode {
        node: WorkflowNodeDto,
    },
    UpdateNode {
        node: WorkflowNodeDto,
    },
    MoveNode {
        node_id: String,
        position: WorkflowPosition,
    },
    DeleteNode {
        node_id: String,
    },
    Connect {
        from: WorkflowPortRef,
        to: WorkflowPortRef,
    },
    Disconnect {
        from: WorkflowPortRef,
        to: WorkflowPortRef,
    },
}

#[derive(Clone, Debug, Serialize)]
struct McpRequest {
    #[serde(skip)]
    label: String,
    jsonrpc: &'static str,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Clone, Debug)]
struct McpTransportEvent {
    request_id: u64,
    tool: String,
    result: Result<Value, String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WorkflowDataType {
    Flow,
    Json,
    Event,
    Preview,
    Component,
}

impl DataTypeTrait<UserState> for WorkflowDataType {
    fn data_type_color(&self, _user_state: &mut UserState) -> Color32 {
        match self {
            Self::Flow => Color32::from_rgb(104, 126, 255),
            Self::Json => GOOD,
            Self::Event => WARN,
            Self::Preview => Color32::from_rgb(221, 117, 255),
            Self::Component => ACCENT_2,
        }
    }

    fn name(&self) -> Cow<'_, str> {
        Cow::Borrowed(match self {
            Self::Flow => "flow",
            Self::Json => "json",
            Self::Event => "event",
            Self::Preview => "preview",
            Self::Component => "component",
        })
    }
}

#[derive(Clone, Debug, Default)]
enum WorkflowValue {
    #[default]
    Empty,
    Text(String),
    Json(String),
}

impl WidgetValueTrait for WorkflowValue {
    type Response = WorkflowResponse;
    type UserState = UserState;
    type NodeData = WorkflowNodeData;

    fn value_widget(
        &mut self,
        param_name: &str,
        _node_id: NodeId,
        ui: &mut egui::Ui,
        _user_state: &mut Self::UserState,
        _node_data: &Self::NodeData,
    ) -> Vec<Self::Response> {
        match self {
            Self::Empty => {
                ui.label(param_name);
            }
            Self::Text(value) | Self::Json(value) => {
                ui.horizontal(|ui| {
                    ui.label(param_name);
                    ui.add(egui::TextEdit::singleline(value).desired_width(150.0));
                });
            }
        }
        Vec::new()
    }
}

#[derive(Clone, Debug)]
struct WorkflowNodeData {
    kind: WorkflowNodeTemplate,
    description: &'static str,
}

impl NodeDataTrait for WorkflowNodeData {
    type Response = WorkflowResponse;
    type UserState = UserState;
    type DataType = WorkflowDataType;
    type ValueType = WorkflowValue;

    fn bottom_ui(
        &self,
        ui: &mut egui::Ui,
        node_id: NodeId,
        _graph: &Graph<Self, Self::DataType, Self::ValueType>,
        _user_state: &mut Self::UserState,
    ) -> Vec<NodeResponse<Self::Response, Self>> {
        let mut responses = Vec::new();
        ui.add_space(7.0);
        ui.label(RichText::new(self.description).small().color(MUTED));
        ui.add_space(4.0);
        if ui.add(ghost_button("Inspect")).clicked() {
            responses.push(NodeResponse::User(WorkflowResponse::Inspect(node_id)));
        }
        responses
    }

    fn titlebar_color(
        &self,
        _ui: &egui::Ui,
        _node_id: NodeId,
        _graph: &Graph<Self, Self::DataType, Self::ValueType>,
        _user_state: &mut Self::UserState,
    ) -> Option<Color32> {
        Some(match self.kind {
            WorkflowNodeTemplate::Input => Color32::from_rgb(47, 78, 182),
            WorkflowNodeTemplate::McpTool => Color32::from_rgb(21, 149, 137),
            WorkflowNodeTemplate::Transform => Color32::from_rgb(166, 100, 30),
            WorkflowNodeTemplate::RunState => Color32::from_rgb(142, 64, 170),
            WorkflowNodeTemplate::Preview => Color32::from_rgb(63, 80, 112),
            WorkflowNodeTemplate::Output => Color32::from_rgb(80, 97, 126),
            WorkflowNodeTemplate::WebComponentSlot => Color32::from_rgb(178, 62, 105),
        })
    }
}

#[derive(Clone, Debug)]
enum WorkflowResponse {
    Inspect(NodeId),
}

impl UserResponseTrait for WorkflowResponse {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WorkflowNodeTemplate {
    Input,
    McpTool,
    Transform,
    RunState,
    Preview,
    Output,
    WebComponentSlot,
}

impl NodeTemplateTrait for WorkflowNodeTemplate {
    type NodeData = WorkflowNodeData;
    type DataType = WorkflowDataType;
    type ValueType = WorkflowValue;
    type UserState = UserState;
    type CategoryType = &'static str;

    fn node_finder_label(&self, _user_state: &mut Self::UserState) -> Cow<'_, str> {
        Cow::Borrowed(self.label())
    }

    fn node_finder_categories(&self, _user_state: &mut Self::UserState) -> Vec<Self::CategoryType> {
        vec![match self {
            Self::Input => "workflow",
            Self::McpTool => "mcp",
            Self::Transform | Self::RunState => "state",
            Self::Preview | Self::Output => "media",
            Self::WebComponentSlot => "extensions",
        }]
    }

    fn node_graph_label(&self, _user_state: &mut Self::UserState) -> String {
        self.label().to_owned()
    }

    fn user_data(&self, _user_state: &mut Self::UserState) -> Self::NodeData {
        WorkflowNodeData {
            kind: *self,
            description: self.description(),
        }
    }

    fn build_node(
        &self,
        graph: &mut Graph<Self::NodeData, Self::DataType, Self::ValueType>,
        _user_state: &mut Self::UserState,
        node_id: NodeId,
    ) {
        match self {
            Self::Input => {
                graph.add_output_param(node_id, "workflow".to_owned(), WorkflowDataType::Flow);
            }
            Self::McpTool => {
                graph.add_input_param(
                    node_id,
                    "workflow".to_owned(),
                    WorkflowDataType::Flow,
                    WorkflowValue::Text("lightflow.list_workflows".to_owned()),
                    InputParamKind::ConnectionOnly,
                    true,
                );
                graph.add_output_param(node_id, "tool_result".to_owned(), WorkflowDataType::Json);
            }
            Self::Transform => {
                graph.add_input_param(
                    node_id,
                    "tool_result".to_owned(),
                    WorkflowDataType::Json,
                    WorkflowValue::Json("{}".to_owned()),
                    InputParamKind::ConnectionOnly,
                    true,
                );
                graph.add_output_param(node_id, "json".to_owned(), WorkflowDataType::Json);
            }
            Self::RunState => {
                graph.add_input_param(
                    node_id,
                    "json".to_owned(),
                    WorkflowDataType::Json,
                    WorkflowValue::Json("{}".to_owned()),
                    InputParamKind::ConnectionOnly,
                    true,
                );
                graph.add_output_param(node_id, "state".to_owned(), WorkflowDataType::Event);
            }
            Self::Preview => {
                graph.add_input_param(
                    node_id,
                    "state".to_owned(),
                    WorkflowDataType::Event,
                    WorkflowValue::Empty,
                    InputParamKind::ConnectionOnly,
                    true,
                );
                graph.add_output_param(node_id, "preview".to_owned(), WorkflowDataType::Preview);
            }
            Self::Output => {
                graph.add_input_param(
                    node_id,
                    "tool_result".to_owned(),
                    WorkflowDataType::Json,
                    WorkflowValue::Json("{}".to_owned()),
                    InputParamKind::ConnectionOnly,
                    true,
                );
            }
            Self::WebComponentSlot => {
                graph.add_input_param(
                    node_id,
                    "component".to_owned(),
                    WorkflowDataType::Component,
                    WorkflowValue::Text(String::new()),
                    InputParamKind::ConstantOnly,
                    true,
                );
                graph.add_input_param(
                    node_id,
                    "json".to_owned(),
                    WorkflowDataType::Json,
                    WorkflowValue::Json("{}".to_owned()),
                    InputParamKind::ConnectionOnly,
                    true,
                );
                graph.add_output_param(node_id, "custom_ui".to_owned(), WorkflowDataType::Preview);
            }
        }
    }
}

impl WorkflowNodeTemplate {
    fn from_protocol_kind(kind: &str) -> Self {
        match kind {
            "workflow_input" | "input" => Self::Input,
            "mcp_tool" | "tool" => Self::McpTool,
            "state_transform" | "transform" => Self::Transform,
            "run_state" | "state" => Self::RunState,
            "preview_sink" | "preview" => Self::Preview,
            "workflow_output" | "output" => Self::Output,
            "web_component_slot" | "web_component" => Self::WebComponentSlot,
            _ => Self::McpTool,
        }
    }

    fn protocol_kind(self) -> &'static str {
        match self {
            Self::Input => "workflow_input",
            Self::McpTool => "mcp_tool",
            Self::Transform => "state_transform",
            Self::RunState => "run_state",
            Self::Preview => "preview_sink",
            Self::Output => "output",
            Self::WebComponentSlot => "web_component_slot",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Input => "Workflow Input",
            Self::McpTool => "MCP Tool",
            Self::Transform => "State Transform",
            Self::RunState => "Run State",
            Self::Preview => "Preview Sink",
            Self::Output => "Output",
            Self::WebComponentSlot => "Web Component Slot",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Input => "Workflow metadata and trigger inputs.",
            Self::McpTool => "Calls LightFlow tools through /mcp.",
            Self::Transform => "Maps structured tool data into graph state.",
            Self::RunState => "Tracks execution state and event streams.",
            Self::Preview => "GPU-backed preview surface placeholder.",
            Self::Output => "Terminal workflow output.",
            Self::WebComponentSlot => "Future TypeScript/Web Components extension point.",
        }
    }
}

struct TemplateCatalog;

impl NodeTemplateIter for TemplateCatalog {
    type Item = WorkflowNodeTemplate;

    fn all_kinds(&self) -> Vec<Self::Item> {
        vec![
            WorkflowNodeTemplate::Input,
            WorkflowNodeTemplate::McpTool,
            WorkflowNodeTemplate::Transform,
            WorkflowNodeTemplate::RunState,
            WorkflowNodeTemplate::Preview,
            WorkflowNodeTemplate::Output,
            WorkflowNodeTemplate::WebComponentSlot,
        ]
    }
}

#[cfg(target_arch = "wasm32")]
fn plugin_node_summaries() -> Vec<String> {
    crate::plugin_api::plugin_node_summaries()
}

#[cfg(target_arch = "wasm32")]
fn plugin_overlay_summaries() -> Vec<String> {
    crate::plugin_api::plugin_overlay_summaries()
}

#[cfg(target_arch = "wasm32")]
fn first_plugin_element_name() -> Option<String> {
    crate::plugin_api::first_plugin_element_name()
}

#[cfg(target_arch = "wasm32")]
fn sync_plugin_component(
    node_id: &str,
    element_name: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    props: serde_json::Value,
) {
    let props = js_sys::JSON::parse(&props.to_string())
        .unwrap_or_else(|_| wasm_bindgen::JsValue::from_str("{}"));
    let _ = crate::plugin_api::sync_lightflow_node_component(
        node_id,
        element_name,
        x,
        y,
        width,
        height,
        props,
    );
}

#[cfg(target_arch = "wasm32")]
fn retain_plugin_components(live_node_ids: &[String]) {
    crate::plugin_api::retain_lightflow_node_components(live_node_ids);
}

#[cfg(not(target_arch = "wasm32"))]
fn plugin_node_summaries() -> Vec<String> {
    Vec::new()
}

#[cfg(not(target_arch = "wasm32"))]
fn plugin_overlay_summaries() -> Vec<String> {
    Vec::new()
}

#[cfg(not(target_arch = "wasm32"))]
fn first_plugin_element_name() -> Option<String> {
    None
}

#[cfg(not(target_arch = "wasm32"))]
fn sync_plugin_component(
    _node_id: &str,
    _element_name: &str,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
    _props: serde_json::Value,
) {
}

#[cfg(not(target_arch = "wasm32"))]
fn retain_plugin_components(_live_node_ids: &[String]) {}

#[cfg(target_arch = "wasm32")]
fn transport_summary() -> String {
    crate::transport_api::transport_summary()
}

#[cfg(not(target_arch = "wasm32"))]
fn transport_summary() -> String {
    "native preview build: browser WebTransport unavailable".to_owned()
}

#[derive(Default)]
struct UserState {
    endpoint: String,
    active_node: Option<NodeId>,
}

pub struct LightFlowApp {
    editor: EditorState,
    user_state: UserState,
    selected_resource: ResourceSelection,
    left_open: bool,
    right_open: bool,
    workflow_id: String,
    base_revision: String,
    loaded_region: Option<WorkflowRegion>,
    total_estimate: Option<u64>,
    next_cursor: Option<String>,
    local_to_remote: HashMap<NodeId, String>,
    remote_to_local: HashMap<String, NodeId>,
    component_snapshots: HashMap<String, Option<String>>,
    dirty_ops: Vec<WorkflowPatchOp>,
    next_request_id: u64,
    mcp_tx: Sender<McpTransportEvent>,
    mcp_rx: Receiver<McpTransportEvent>,
    pending_requests: HashMap<u64, String>,
    mcp_tools: Vec<String>,
    mcp_resources: Vec<McpResource>,
    selected_mcp_resource_uri: Option<String>,
    mcp_resource_preview: String,
    mcp_prompts: Vec<McpPrompt>,
    selected_mcp_prompt_name: Option<String>,
    mcp_prompt_preview: String,
    mcp_status: String,
    dag_status: String,
    auto_read_visible: bool,
    window_graph_to_region: bool,
    visible_region_node_ids: HashSet<String>,
    viewport_signature: Option<String>,
    requested_viewport_signature: Option<String>,
    stable_viewport_frames: u8,
    frames_since_region_request: u16,
}

impl LightFlowApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        lightflow_step("app new: apply style");
        Self::apply_modern_style(&cc.egui_ctx);

        lightflow_step("app new: create channel");
        let (mcp_tx, mcp_rx) = mpsc::channel();
        lightflow_step("app new: create state");
        let mut app = Self {
            editor: EditorState::new(1.0),
            user_state: UserState {
                endpoint: "/mcp".to_owned(),
                active_node: None,
            },
            selected_resource: ResourceSelection::McpFile,
            left_open: true,
            right_open: true,
            workflow_id: "workflow.default".to_owned(),
            base_revision: "local-draft".to_owned(),
            loaded_region: None,
            total_estimate: None,
            next_cursor: None,
            local_to_remote: HashMap::new(),
            remote_to_local: HashMap::new(),
            component_snapshots: HashMap::new(),
            dirty_ops: Vec::new(),
            next_request_id: 1,
            mcp_tx,
            mcp_rx,
            pending_requests: HashMap::new(),
            mcp_tools: Vec::new(),
            mcp_resources: Vec::new(),
            selected_mcp_resource_uri: None,
            mcp_resource_preview: String::new(),
            mcp_prompts: Vec::new(),
            selected_mcp_prompt_name: None,
            mcp_prompt_preview: String::new(),
            mcp_status: "MCP idle".to_owned(),
            dag_status: String::new(),
            auto_read_visible: false,
            window_graph_to_region: true,
            visible_region_node_ids: HashSet::new(),
            viewport_signature: None,
            requested_viewport_signature: None,
            stable_viewport_frames: 0,
            frames_since_region_request: 0,
        };
        lightflow_step("app new: seed workflow");
        app.seed_showcase_workflow();
        lightflow_step("app new: update dag");
        app.update_dag_status();
        lightflow_step("app new: done");
        app
    }

    fn apply_modern_style(ctx: &egui::Context) {
        let mut style = (*ctx.style()).clone();
        style.visuals = egui::Visuals::dark();
        style.visuals.override_text_color = Some(TEXT);
        style.visuals.panel_fill = BG;
        style.visuals.window_fill = SURFACE;
        style.visuals.window_stroke = Stroke::new(1.0, STROKE);
        style.visuals.window_rounding = egui::Rounding::same(18.0);
        style.visuals.menu_rounding = egui::Rounding::same(12.0);
        style.visuals.extreme_bg_color = Color32::from_rgb(9, 14, 24);
        style.visuals.faint_bg_color = Color32::from_rgba_unmultiplied(255, 255, 255, 8);
        style.visuals.code_bg_color = Color32::from_rgb(12, 18, 30);
        style.visuals.selection.bg_fill = Color32::from_rgba_unmultiplied(112, 86, 255, 90);
        style.visuals.selection.stroke = Stroke::new(1.0, ACCENT_2);
        style.visuals.hyperlink_color = ACCENT_2;
        style.visuals.warn_fg_color = WARN;
        style.visuals.widgets.noninteractive.bg_fill = SURFACE;
        style.visuals.widgets.noninteractive.weak_bg_fill = SURFACE_2;
        style.visuals.widgets.noninteractive.bg_stroke = Stroke::new(1.0, STROKE);
        style.visuals.widgets.noninteractive.fg_stroke = Stroke::new(1.0, TEXT);
        style.visuals.widgets.inactive.bg_fill = Color32::from_rgba_unmultiplied(255, 255, 255, 18);
        style.visuals.widgets.inactive.weak_bg_fill =
            Color32::from_rgba_unmultiplied(255, 255, 255, 14);
        style.visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, STROKE);
        style.visuals.widgets.inactive.fg_stroke = Stroke::new(1.0, TEXT);
        style.visuals.widgets.hovered.bg_fill = Color32::from_rgba_unmultiplied(112, 86, 255, 58);
        style.visuals.widgets.hovered.weak_bg_fill =
            Color32::from_rgba_unmultiplied(112, 86, 255, 42);
        style.visuals.widgets.hovered.bg_stroke =
            Stroke::new(1.0, Color32::from_rgba_unmultiplied(180, 164, 255, 150));
        style.visuals.widgets.hovered.fg_stroke = Stroke::new(1.0, Color32::WHITE);
        style.visuals.widgets.active.bg_fill = Color32::from_rgb(112, 86, 255);
        style.visuals.widgets.active.weak_bg_fill =
            Color32::from_rgba_unmultiplied(112, 86, 255, 120);
        style.visuals.widgets.active.bg_stroke =
            Stroke::new(1.0, Color32::from_rgba_unmultiplied(255, 255, 255, 140));
        style.visuals.widgets.active.fg_stroke = Stroke::new(1.0, Color32::WHITE);
        for visuals in [
            &mut style.visuals.widgets.noninteractive,
            &mut style.visuals.widgets.inactive,
            &mut style.visuals.widgets.hovered,
            &mut style.visuals.widgets.active,
            &mut style.visuals.widgets.open,
        ] {
            visuals.rounding = egui::Rounding::same(10.0);
        }
        style.spacing.item_spacing = egui::vec2(10.0, 10.0);
        style.spacing.button_padding = egui::vec2(12.0, 8.0);
        style.spacing.window_margin = egui::Margin::symmetric(16.0, 14.0);
        style.spacing.menu_margin = egui::Margin::same(12.0);
        style.spacing.interact_size = egui::vec2(40.0, 34.0);
        style.spacing.indent = 18.0;
        ctx.set_style(style);
    }

    fn seed_showcase_workflow(&mut self) {
        let input = self.add_template(WorkflowNodeTemplate::Input, egui::pos2(70.0, 120.0));
        let tool = self.add_template(WorkflowNodeTemplate::McpTool, egui::pos2(340.0, 108.0));
        let transform =
            self.add_template(WorkflowNodeTemplate::Transform, egui::pos2(630.0, 132.0));
        let state = self.add_template(WorkflowNodeTemplate::RunState, egui::pos2(910.0, 94.0));
        let preview = self.add_template(WorkflowNodeTemplate::Preview, egui::pos2(1190.0, 136.0));
        let component = self.add_template(
            WorkflowNodeTemplate::WebComponentSlot,
            egui::pos2(910.0, 360.0),
        );

        self.connect(input, "workflow", tool, "workflow");
        self.connect(tool, "tool_result", transform, "tool_result");
        self.connect(transform, "json", state, "json");
        self.connect(state, "state", preview, "state");
        self.connect(transform, "json", component, "json");

        self.local_to_remote
            .insert(input, "workflow-input".to_owned());
        self.local_to_remote
            .insert(tool, "mcp-tool-call".to_owned());
        self.local_to_remote
            .insert(transform, "state-transform".to_owned());
        self.local_to_remote
            .insert(state, "runtime-state".to_owned());
        self.local_to_remote
            .insert(preview, "preview-sink".to_owned());
        self.local_to_remote
            .insert(component, "component-slot".to_owned());
        for (local, remote) in self.local_to_remote.clone() {
            self.remote_to_local.insert(remote, local);
        }
    }

    fn add_template(&mut self, template: WorkflowNodeTemplate, position: egui::Pos2) -> NodeId {
        let label = template.node_graph_label(&mut self.user_state);
        let user_data = template.user_data(&mut self.user_state);
        let node_id = self
            .editor
            .graph
            .add_node(label, user_data, |graph, node_id| {
                template.build_node(graph, &mut self.user_state, node_id);
            });
        self.editor.node_order.push(node_id);
        self.editor.node_positions.insert(node_id, position);
        node_id
    }

    fn connect(&mut self, from: NodeId, output: &str, to: NodeId, input: &str) {
        let output = self.editor.graph[from].get_output(output);
        let input = self.editor.graph[to].get_input(input);
        if let (Ok(output), Ok(input)) = (output, input) {
            self.editor.graph.add_connection(output, input, 0);
        }
    }

    fn workflow_region_from_canvas(&self) -> WorkflowRegion {
        let rect = self.editor.pan_zoom.clip_rect;
        let zoom = self.editor.pan_zoom.zoom.max(0.01);
        WorkflowRegion {
            x: (-self.editor.pan_zoom.pan.x / zoom).round(),
            y: (-self.editor.pan_zoom.pan.y / zoom).round(),
            width: (rect.width() / zoom).round().max(1.0),
            height: (rect.height() / zoom).round().max(1.0),
            zoom,
            limit: 500,
            cursor: self.next_cursor.clone(),
        }
    }

    fn region_signature(region: &WorkflowRegion) -> String {
        format!(
            "{}:{}:{}:{}:{:.2}:{}",
            region.x, region.y, region.width, region.height, region.zoom, region.limit
        )
    }

    fn has_pending_tool(&self, tool: &str) -> bool {
        self.pending_requests
            .values()
            .any(|pending| pending == tool)
    }

    fn observe_viewport_for_auto_read(&mut self) {
        self.frames_since_region_request = self.frames_since_region_request.saturating_add(1);
        if !self.auto_read_visible {
            return;
        }

        let region = self.workflow_region_from_canvas();
        let signature = Self::region_signature(&region);
        if self.viewport_signature.as_deref() == Some(signature.as_str()) {
            self.stable_viewport_frames = self.stable_viewport_frames.saturating_add(1);
        } else {
            self.viewport_signature = Some(signature);
            self.stable_viewport_frames = 0;
            return;
        }

        let signature = self.viewport_signature.clone().unwrap_or_default();
        if self.requested_viewport_signature.as_deref() == Some(signature.as_str()) {
            return;
        }
        if self.stable_viewport_frames < 12 {
            return;
        }
        if self.frames_since_region_request < 30 {
            return;
        }
        if self.has_pending_tool("lightflow.workflow.read_region") {
            return;
        }

        self.requested_viewport_signature = Some(signature);
        self.read_visible_region_from_mcp_with_region(region);
    }

    fn workflow_patch(&self) -> WorkflowPatch {
        WorkflowPatch {
            workflow_id: self.workflow_id.clone(),
            base_revision: self.base_revision.clone(),
            ops: self.dirty_ops.clone(),
        }
    }

    fn node_remote_id(&self, node_id: NodeId) -> String {
        self.local_to_remote
            .get(&node_id)
            .cloned()
            .unwrap_or_else(|| format!("local::{node_id:?}"))
    }

    fn node_position(&self, node_id: NodeId) -> WorkflowPosition {
        let position = self
            .editor
            .node_positions
            .get(node_id)
            .copied()
            .unwrap_or(egui::Pos2::ZERO);
        WorkflowPosition {
            x: position.x,
            y: position.y,
        }
    }

    fn node_kind_label(&self, node_id: NodeId) -> String {
        self.editor
            .graph
            .nodes
            .get(node_id)
            .map(|node| node.user_data.kind.protocol_kind().to_owned())
            .unwrap_or_else(|| "unknown".to_owned())
    }

    fn node_title(&self, node_id: NodeId) -> String {
        self.editor
            .graph
            .nodes
            .get(node_id)
            .map(|node| node.label.clone())
            .unwrap_or_else(|| "unknown".to_owned())
    }

    fn set_node_title(&mut self, node_id: NodeId, title: String) -> bool {
        let title = title.trim().to_owned();
        if title.is_empty() {
            return false;
        }
        let Some(node) = self.editor.graph.nodes.get_mut(node_id) else {
            return false;
        };
        if node.label == title {
            return false;
        }
        node.label = title;
        true
    }

    fn web_component_name(&self, node_id: NodeId) -> Option<String> {
        let node = self.editor.graph.nodes.get(node_id)?;
        let input_id = node.get_input("component").ok()?;
        match self.editor.graph.get_input(input_id).value() {
            WorkflowValue::Text(value) if !value.trim().is_empty() => Some(value.trim().to_owned()),
            _ => None,
        }
    }

    fn set_web_component_name(&mut self, node_id: NodeId, component: Option<String>) -> bool {
        let Some(component) = component else {
            return false;
        };
        let Some(node) = self.editor.graph.nodes.get(node_id) else {
            return false;
        };
        let Ok(input_id) = node.get_input("component") else {
            return false;
        };
        if let Some(input) = self.editor.graph.inputs.get_mut(input_id) {
            if matches!(&input.value, WorkflowValue::Text(existing) if existing == &component) {
                return false;
            }
            input.value = WorkflowValue::Text(component);
            return true;
        }
        false
    }

    fn node_dto(&self, node_id: NodeId) -> WorkflowNodeDto {
        WorkflowNodeDto {
            id: self.node_remote_id(node_id),
            kind: self.node_kind_label(node_id),
            title: self.node_title(node_id),
            position: self.node_position(node_id),
            component: self.web_component_name(node_id),
        }
    }

    fn output_name(&self, output_id: OutputId) -> String {
        let node_id = self.editor.graph.get_output(output_id).node;
        self.editor.graph[node_id]
            .outputs
            .iter()
            .find_map(|(name, id)| (*id == output_id).then(|| name.clone()))
            .unwrap_or_else(|| "out".to_owned())
    }

    fn input_name(&self, input_id: InputId) -> String {
        let node_id = self.editor.graph.get_input(input_id).node;
        self.editor.graph[node_id]
            .inputs
            .iter()
            .find_map(|(name, id)| (*id == input_id).then(|| name.clone()))
            .unwrap_or_else(|| "in".to_owned())
    }

    fn connection_refs(
        &self,
        input: InputId,
        output: OutputId,
    ) -> (WorkflowPortRef, WorkflowPortRef) {
        let source = self.editor.graph.get_output(output).node;
        let target = self.editor.graph.get_input(input).node;
        (
            WorkflowPortRef {
                node: self.node_remote_id(source),
                port: self.output_name(output),
            },
            WorkflowPortRef {
                node: self.node_remote_id(target),
                port: self.input_name(input),
            },
        )
    }

    fn push_dirty_op(&mut self, op: WorkflowPatchOp) {
        self.dirty_ops.push(op);
        self.mcp_status = format!("{} unsaved workflow operation(s)", self.dirty_ops.len());
    }

    fn record_move_node(&mut self, node_id: NodeId) {
        let remote_id = self.node_remote_id(node_id);
        let position = self.node_position(node_id);
        if let Some(WorkflowPatchOp::MoveNode {
            position: existing, ..
        }) = self.dirty_ops.iter_mut().rev().find(|op| {
            matches!(
                op,
                WorkflowPatchOp::MoveNode {
                    node_id: id,
                    ..
                } if id == &remote_id
            )
        }) {
            *existing = position;
            return;
        }

        self.push_dirty_op(WorkflowPatchOp::MoveNode {
            node_id: remote_id,
            position,
        });
    }

    fn record_update_node(&mut self, node_id: NodeId) {
        let node = self.node_dto(node_id);
        if let Some(WorkflowPatchOp::AddNode { node: existing }) =
            self.dirty_ops.iter_mut().rev().find(|op| {
                matches!(
                    op,
                    WorkflowPatchOp::AddNode {
                        node: existing,
                    } if existing.id == node.id
                )
            })
        {
            *existing = node;
            self.mcp_status = format!("{} unsaved workflow operation(s)", self.dirty_ops.len());
            return;
        }

        if let Some(WorkflowPatchOp::UpdateNode { node: existing }) =
            self.dirty_ops.iter_mut().rev().find(|op| {
                matches!(
                    op,
                    WorkflowPatchOp::UpdateNode {
                        node: existing,
                    } if existing.id == node.id
                )
            })
        {
            *existing = node;
            self.mcp_status = format!("{} unsaved workflow operation(s)", self.dirty_ops.len());
            return;
        }

        self.push_dirty_op(WorkflowPatchOp::UpdateNode { node });
    }

    fn detect_component_patch_changes(&mut self) {
        let node_ids = self.editor.graph.iter_nodes().collect::<Vec<_>>();
        for node_id in node_ids {
            let Some(node) = self.editor.graph.nodes.get(node_id) else {
                continue;
            };
            if node.user_data.kind != WorkflowNodeTemplate::WebComponentSlot {
                continue;
            }

            let remote_id = self.node_remote_id(node_id);
            let current = self.web_component_name(node_id);
            if let std::collections::hash_map::Entry::Vacant(entry) =
                self.component_snapshots.entry(remote_id.clone())
            {
                entry.insert(current);
                continue;
            }

            if self.component_snapshots.get(&remote_id) != Some(&current) {
                self.component_snapshots
                    .insert(remote_id.clone(), current.clone());
                self.record_update_node(node_id);
            }
        }
    }

    fn add_node_from_toolbar(&mut self, template: WorkflowNodeTemplate) {
        let next = self.editor.graph.nodes.len() as f32;
        let node_id = self.add_template(template, egui::pos2(120.0 + next * 24.0, 160.0));
        self.editor.selected_nodes = vec![node_id];
        self.user_state.active_node = Some(node_id);
        self.push_dirty_op(WorkflowPatchOp::AddNode {
            node: self.node_dto(node_id),
        });
        self.update_dag_status();
    }

    fn delete_selected_nodes(&mut self) {
        let selected = self.editor.selected_nodes.clone();
        for node_id in selected {
            if self.editor.graph.nodes.contains_key(node_id) {
                let remote_id = self.node_remote_id(node_id);
                let _ = self.editor.graph.remove_node(node_id);
                self.editor.node_positions.remove(node_id);
                self.editor.node_order.retain(|id| *id != node_id);
                self.editor.selected_nodes.retain(|id| *id != node_id);
                self.local_to_remote.remove(&node_id);
                self.remote_to_local.retain(|_, local| *local != node_id);
                self.push_dirty_op(WorkflowPatchOp::DeleteNode { node_id: remote_id });
            }
        }
        self.user_state.active_node = None;
        self.update_dag_status();
    }

    fn call_mcp_tool(&mut self, tool: &str, arguments: Value) {
        self.call_mcp_method(
            tool,
            "tools/call",
            Some(json!({
                "name": tool,
                "arguments": arguments,
            })),
        );
    }

    fn call_mcp_method(&mut self, label: &str, method: &str, params: Option<Value>) {
        let request_id = self.next_request_id;
        self.next_request_id += 1;

        let request = McpRequest {
            label: label.to_owned(),
            jsonrpc: "2.0",
            id: request_id,
            method: method.to_owned(),
            params,
        };

        self.pending_requests.insert(request_id, label.to_owned());
        self.mcp_status = format!("MCP request #{request_id}: {label}");
        send_mcp_request(
            self.user_state.endpoint.clone(),
            request,
            self.mcp_tx.clone(),
        );
    }

    fn discover_mcp_tools(&mut self) {
        self.call_mcp_method("tools/list", "tools/list", None);
    }

    fn discover_mcp_resources(&mut self) {
        self.call_mcp_method("resources/list", "resources/list", None);
    }

    fn read_selected_mcp_resource(&mut self) {
        let Some(uri) = self.selected_mcp_resource_uri.clone() else {
            self.mcp_status = "No MCP resource selected".to_owned();
            return;
        };
        self.call_mcp_method(
            "resources/read",
            "resources/read",
            Some(json!({
                "uri": uri,
            })),
        );
    }

    fn discover_mcp_prompts(&mut self) {
        self.call_mcp_method("prompts/list", "prompts/list", None);
    }

    fn get_selected_mcp_prompt(&mut self) {
        let Some(name) = self.selected_mcp_prompt_name.clone() else {
            self.mcp_status = "No MCP prompt selected".to_owned();
            return;
        };
        self.call_mcp_method(
            "prompts/get",
            "prompts/get",
            Some(json!({
                "name": name,
                "arguments": {},
            })),
        );
    }

    fn open_workflow_from_mcp(&mut self) {
        self.call_mcp_tool(
            "lightflow.workflow.open",
            json!({
                "workflow_id": self.workflow_id,
                "mode": "metadata_only"
            }),
        );
    }

    fn read_visible_region_from_mcp(&mut self) {
        let region = self.workflow_region_from_canvas();
        self.requested_viewport_signature = Some(Self::region_signature(&region));
        self.read_visible_region_from_mcp_with_region(region);
    }

    fn read_visible_region_from_mcp_with_region(&mut self, region: WorkflowRegion) {
        self.loaded_region = Some(region.clone());
        self.frames_since_region_request = 0;
        self.call_mcp_tool(
            "lightflow.workflow.read_region",
            json!({
                "workflow_id": self.workflow_id,
                "region": region,
            }),
        );
    }

    fn validate_workflow_with_mcp(&mut self) {
        self.update_dag_status();
        self.call_mcp_tool(
            "lightflow.workflow.validate",
            json!({
                "workflow_id": self.workflow_id,
                "base_revision": self.base_revision,
                "visible_region": self.workflow_region_from_canvas(),
                "local_patch": self.workflow_patch(),
            }),
        );
    }

    fn save_patch_to_mcp(&mut self) {
        if self.dirty_ops.is_empty() {
            self.mcp_status = "No workflow changes to save".to_owned();
            return;
        }

        self.call_mcp_tool(
            "lightflow.workflow.apply_patch",
            json!({
                "patch": self.workflow_patch(),
            }),
        );
    }

    fn poll_mcp_events(&mut self) {
        while let Ok(event) = self.mcp_rx.try_recv() {
            self.pending_requests.remove(&event.request_id);
            match event.result {
                Ok(value) => {
                    self.mcp_status = format!("MCP response #{}: {}", event.request_id, event.tool);
                    if event.tool == "lightflow.workflow.read_region" {
                        match Self::extract_region_response(&value) {
                            Ok(region) => self.merge_region_response(region),
                            Err(err) => {
                                self.mcp_status =
                                    format!("read_region returned unrecognized payload: {err}");
                            }
                        }
                    } else if event.tool == "lightflow.workflow.apply_patch" {
                        self.dirty_ops.clear();
                        if let Some(revision) = value
                            .pointer("/result/revision")
                            .and_then(Value::as_str)
                            .or_else(|| {
                                value
                                    .pointer("/result/base_revision")
                                    .and_then(Value::as_str)
                            })
                        {
                            self.base_revision = revision.to_owned();
                        }
                    } else if event.tool == "tools/list" {
                        self.mcp_tools = Self::extract_tool_names(&value);
                        self.mcp_status =
                            format!("Discovered {} MCP tool(s)", self.mcp_tools.len());
                    } else if event.tool == "resources/list" {
                        self.mcp_resources = Self::extract_resources(&value);
                        self.mcp_status =
                            format!("Discovered {} MCP resource(s)", self.mcp_resources.len());
                    } else if event.tool == "resources/read" {
                        self.mcp_resource_preview = Self::extract_resource_preview(&value);
                        self.mcp_status = format!(
                            "Read MCP resource ({} bytes)",
                            self.mcp_resource_preview.len()
                        );
                    } else if event.tool == "prompts/list" {
                        self.mcp_prompts = Self::extract_prompts(&value);
                        self.mcp_status =
                            format!("Discovered {} MCP prompt(s)", self.mcp_prompts.len());
                    } else if event.tool == "prompts/get" {
                        self.mcp_prompt_preview = Self::extract_prompt_preview(&value);
                        self.mcp_status = format!(
                            "Loaded MCP prompt ({} bytes)",
                            self.mcp_prompt_preview.len()
                        );
                    }
                }
                Err(err) => {
                    self.mcp_status = format!("MCP request #{} failed: {}", event.request_id, err);
                }
            }
        }
    }

    fn extract_region_response(value: &Value) -> Result<WorkflowRegionResponse, String> {
        let candidates = [
            value.get("result").cloned(),
            value.pointer("/result/structuredContent").cloned(),
        ];
        for candidate in candidates.into_iter().flatten() {
            if let Ok(region) = serde_json::from_value::<WorkflowRegionResponse>(candidate) {
                return Ok(region);
            }
        }

        if let Some(text) = value
            .pointer("/result/content/0/text")
            .and_then(Value::as_str)
        {
            return serde_json::from_str::<WorkflowRegionResponse>(text)
                .map_err(|err| err.to_string());
        }

        serde_json::from_value::<WorkflowRegionResponse>(value.clone())
            .map_err(|err| err.to_string())
    }

    fn extract_tool_names(value: &Value) -> Vec<String> {
        value
            .pointer("/result/tools")
            .and_then(Value::as_array)
            .or_else(|| value.pointer("/tools").and_then(Value::as_array))
            .into_iter()
            .flatten()
            .filter_map(|tool| {
                tool.get("name")
                    .and_then(Value::as_str)
                    .or_else(|| tool.as_str())
                    .map(str::to_owned)
            })
            .collect()
    }

    fn extract_resources(value: &Value) -> Vec<McpResource> {
        value
            .pointer("/result/resources")
            .and_then(Value::as_array)
            .or_else(|| value.pointer("/resources").and_then(Value::as_array))
            .into_iter()
            .flatten()
            .filter_map(|resource| {
                if let Some(uri) = resource.get("uri").and_then(Value::as_str) {
                    let name = resource.get("name").and_then(Value::as_str).unwrap_or(uri);
                    Some(McpResource {
                        name: name.to_owned(),
                        uri: uri.to_owned(),
                    })
                } else {
                    resource.as_str().map(|uri| McpResource {
                        name: uri.to_owned(),
                        uri: uri.to_owned(),
                    })
                }
            })
            .collect()
    }

    fn extract_resource_preview(value: &Value) -> String {
        if let Some(contents) = value
            .pointer("/result/contents")
            .and_then(Value::as_array)
            .or_else(|| value.pointer("/contents").and_then(Value::as_array))
        {
            return contents
                .iter()
                .filter_map(|item| {
                    item.get("text")
                        .and_then(Value::as_str)
                        .or_else(|| item.get("blob").and_then(Value::as_str))
                        .or_else(|| item.as_str())
                })
                .collect::<Vec<_>>()
                .join("\n\n");
        }

        value
            .pointer("/result/content/0/text")
            .and_then(Value::as_str)
            .or_else(|| value.pointer("/result/text").and_then(Value::as_str))
            .unwrap_or("")
            .to_owned()
    }

    fn extract_prompts(value: &Value) -> Vec<McpPrompt> {
        value
            .pointer("/result/prompts")
            .and_then(Value::as_array)
            .or_else(|| value.pointer("/prompts").and_then(Value::as_array))
            .into_iter()
            .flatten()
            .filter_map(|prompt| {
                prompt
                    .get("name")
                    .and_then(Value::as_str)
                    .or_else(|| prompt.as_str())
                    .map(|name| McpPrompt {
                        name: name.to_owned(),
                        description: prompt
                            .get("description")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                    })
            })
            .collect()
    }

    fn extract_prompt_preview(value: &Value) -> String {
        if let Some(messages) = value
            .pointer("/result/messages")
            .and_then(Value::as_array)
            .or_else(|| value.pointer("/messages").and_then(Value::as_array))
        {
            return messages
                .iter()
                .map(|message| {
                    let role = message
                        .get("role")
                        .and_then(Value::as_str)
                        .unwrap_or("message");
                    let text = message
                        .pointer("/content/text")
                        .and_then(Value::as_str)
                        .or_else(|| message.get("text").and_then(Value::as_str))
                        .unwrap_or("");
                    format!("{role}: {text}")
                })
                .collect::<Vec<_>>()
                .join("\n\n");
        }

        value
            .pointer("/result/description")
            .and_then(Value::as_str)
            .or_else(|| value.pointer("/result/text").and_then(Value::as_str))
            .unwrap_or("")
            .to_owned()
    }

    fn merge_region_response(&mut self, response: WorkflowRegionResponse) {
        self.workflow_id = response.workflow_id;
        self.base_revision = response.revision;
        self.total_estimate = response.total_estimate;
        self.next_cursor = response.next_cursor;
        let region_node_ids = response
            .nodes
            .iter()
            .map(|node| node.id.clone())
            .collect::<HashSet<_>>();
        self.visible_region_node_ids = region_node_ids.clone();

        if self.window_graph_to_region {
            self.prune_remote_nodes_outside_region(&region_node_ids);
        }

        for node in response.nodes {
            let template = WorkflowNodeTemplate::from_protocol_kind(&node.kind);
            let node_id = if let Some(existing) = self.remote_to_local.get(&node.id).copied() {
                existing
            } else {
                let node_id =
                    self.add_template(template, egui::pos2(node.position.x, node.position.y));
                self.local_to_remote.insert(node_id, node.id.clone());
                self.remote_to_local.insert(node.id.clone(), node_id);
                node_id
            };

            if let Some(local_node) = self.editor.graph.nodes.get_mut(node_id) {
                local_node.label = node.title;
            }
            self.editor
                .node_positions
                .insert(node_id, egui::pos2(node.position.x, node.position.y));
            if template == WorkflowNodeTemplate::WebComponentSlot {
                let component = node.component;
                self.set_web_component_name(node_id, component);
                self.component_snapshots.insert(
                    self.node_remote_id(node_id),
                    self.web_component_name(node_id),
                );
            }
        }

        for edge in response.edges {
            let Some(source) = self.remote_to_local.get(&edge.from.node).copied() else {
                continue;
            };
            let Some(target) = self.remote_to_local.get(&edge.to.node).copied() else {
                continue;
            };
            self.connect(source, &edge.from.port, target, &edge.to.port);
        }

        self.update_dag_status();
    }

    fn prune_remote_nodes_outside_region(&mut self, region_node_ids: &HashSet<String>) {
        let stale = self
            .local_to_remote
            .iter()
            .filter_map(|(local, remote)| (!region_node_ids.contains(remote)).then_some(*local))
            .collect::<Vec<_>>();

        for node_id in stale {
            let Some(remote_id) = self.local_to_remote.remove(&node_id) else {
                continue;
            };
            self.remote_to_local.remove(&remote_id);
            self.component_snapshots.remove(&remote_id);
            if self.editor.graph.nodes.contains_key(node_id) {
                let _ = self.editor.graph.remove_node(node_id);
            }
            self.editor.node_positions.remove(node_id);
            self.editor.node_order.retain(|id| *id != node_id);
            self.editor.selected_nodes.retain(|id| *id != node_id);
            if self.user_state.active_node == Some(node_id) {
                self.user_state.active_node = None;
            }
        }
    }

    fn update_dag_status(&mut self) {
        let mut dag: DiGraph<NodeId, ()> = DiGraph::new();
        let mut indices: HashMap<NodeId, NodeIndex> = HashMap::new();

        for node_id in self.editor.graph.iter_nodes() {
            indices.insert(node_id, dag.add_node(node_id));
        }

        for (input_id, output_id) in self.editor.graph.iter_connections() {
            let source = self.editor.graph.get_output(output_id).node;
            let target = self.editor.graph.get_input(input_id).node();
            if let (Some(source), Some(target)) = (indices.get(&source), indices.get(&target)) {
                dag.add_edge(*source, *target, ());
            }
        }

        self.dag_status = match toposort(&dag, None) {
            Ok(order) => format!("DAG valid · {} nodes", order.len()),
            Err(_) => "DAG invalid · cycle detected".to_owned(),
        };
    }

    fn top_bar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("top_bar")
            .frame(
                egui::Frame::default()
                    .fill(Color32::from_rgba_unmultiplied(9, 14, 26, 242))
                    .stroke(Stroke::new(1.0, STROKE))
                    .inner_margin(egui::Margin::symmetric(18.0, 12.0)),
            )
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    let mark_rect = ui
                        .allocate_exact_size(egui::vec2(34.0, 34.0), egui::Sense::hover())
                        .0;
                    ui.painter().circle_filled(mark_rect.center(), 17.0, ACCENT);
                    ui.painter().circle_filled(
                        mark_rect.center() + egui::vec2(5.0, -5.0),
                        8.0,
                        ACCENT_2,
                    );
                    ui.vertical(|ui| {
                        ui.label(RichText::new("LightFlow").strong().size(19.0).color(TEXT));
                        ui.label(muted_text("visual workflow cockpit").small());
                    });

                    ui.add_space(14.0);
                    ui.label(
                        RichText::new(&self.workflow_id)
                            .small()
                            .color(MUTED)
                            .background_color(Color32::from_rgba_unmultiplied(255, 255, 255, 12)),
                    );
                    if !self.dirty_ops.is_empty() {
                        ui.label(
                            RichText::new(format!("{} unsaved", self.dirty_ops.len()))
                                .small()
                                .strong()
                                .color(WARN),
                        );
                    }

                    ui.add_space(12.0);
                    if ui
                        .add(ghost_button(if self.left_open {
                            "Hide explorer"
                        } else {
                            "Explorer"
                        }))
                        .clicked()
                    {
                        self.left_open = !self.left_open;
                    }
                    if ui.add(ghost_button("Open")).clicked() {
                        self.open_workflow_from_mcp();
                    }
                    if ui.add(ghost_button("Read visible")).clicked() {
                        self.read_visible_region_from_mcp();
                    }
                    if ui.add(ghost_button("Validate")).clicked() {
                        self.validate_workflow_with_mcp();
                    }
                    if ui.add(accent_button("Save patch")).clicked() {
                        self.save_patch_to_mcp();
                    }
                    ui.menu_button("Add node", |ui| {
                        ui.label(section_title("Node templates"));
                        ui.separator();
                        for template in TemplateCatalog.all_kinds() {
                            if ui.add(ghost_button(template.label())).clicked() {
                                self.add_node_from_toolbar(template);
                                ui.close_menu();
                            }
                        }
                    });
                    if ui.add(ghost_button("Delete")).clicked() {
                        self.delete_selected_nodes();
                    }

                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.add(ghost_button("Inspector")).clicked() {
                            self.right_open = !self.right_open;
                        }
                        ui.menu_button("Operator", |ui| {
                            ui.label(section_title("Local operator"));
                            ui.label(muted_text("No embedded agent identity").small());
                        });
                        ui.checkbox(&mut self.window_graph_to_region, "window");
                        ui.checkbox(&mut self.auto_read_visible, "auto read");
                    });
                });
            });
    }

    fn resource_explorer(&mut self, ctx: &egui::Context) {
        if !self.left_open {
            return;
        }

        egui::SidePanel::left("resource_explorer")
            .resizable(true)
            .default_width(300.0)
            .frame(
                egui::Frame::default()
                    .fill(Color32::from_rgba_unmultiplied(10, 16, 29, 238))
                    .stroke(Stroke::new(1.0, STROKE))
                    .inner_margin(egui::Margin::symmetric(16.0, 16.0)),
            )
            .show(ctx, |ui| {
                ui.label(
                    RichText::new("Resource Explorer")
                        .strong()
                        .size(18.0)
                        .color(TEXT),
                );
                ui.label(muted_text("MCP tools, workflow regions, prompts and run state.").small());
                ui.add_space(12.0);
                self.resource_button(
                    ui,
                    ResourceSelection::McpFile,
                    "mcp.json",
                    "JSON-RPC tools/call over /mcp",
                );
                ui.collapsing("workflows", |ui| {
                    self.resource_button(
                        ui,
                        ResourceSelection::Workflow,
                        "default.workflow",
                        "region-loaded graph document",
                    );
                });
                ui.collapsing("resources", |ui| {
                    self.resource_button(ui, ResourceSelection::Tool, "tools/list", "MCP method");
                    for tool in self.mcp_tools.clone() {
                        self.resource_button(
                            ui,
                            ResourceSelection::Tool,
                            &tool,
                            "discovered MCP tool",
                        );
                    }
                    self.resource_button(
                        ui,
                        ResourceSelection::Resource,
                        "resources/list",
                        "MCP resource catalog",
                    );
                    for resource in self.mcp_resources.clone() {
                        self.mcp_resource_button(ui, &resource);
                    }
                    self.resource_button(
                        ui,
                        ResourceSelection::Prompt,
                        "prompts/list",
                        "MCP prompt catalog",
                    );
                    for prompt in self.mcp_prompts.clone() {
                        self.mcp_prompt_button(ui, &prompt);
                    }
                    self.resource_button(
                        ui,
                        ResourceSelection::RunState,
                        "lightflow://runs",
                        "run manifests",
                    );
                });
            });
    }

    fn resource_button(
        &mut self,
        ui: &mut egui::Ui,
        selection: ResourceSelection,
        label: &str,
        hint: &str,
    ) {
        let selected = self.selected_resource == selection;
        let fill = if selected {
            Color32::from_rgba_unmultiplied(112, 86, 255, 60)
        } else {
            Color32::from_rgba_unmultiplied(255, 255, 255, 10)
        };
        let stroke = if selected {
            Stroke::new(1.0, Color32::from_rgba_unmultiplied(180, 164, 255, 160))
        } else {
            Stroke::new(1.0, Color32::from_rgba_unmultiplied(129, 156, 205, 34))
        };
        let response = egui::Frame::default()
            .fill(fill)
            .stroke(stroke)
            .rounding(egui::Rounding::same(12.0))
            .inner_margin(egui::Margin::symmetric(12.0, 9.0))
            .show(ui, |ui| {
                ui.label(RichText::new(label).strong().color(TEXT));
                ui.label(muted_text(hint).small());
            })
            .response
            .interact(egui::Sense::click());
        if response.clicked() {
            self.selected_resource = selection;
            self.right_open = true;
        }
    }

    fn mcp_resource_button(&mut self, ui: &mut egui::Ui, resource: &McpResource) {
        let label = resource.label();
        let selected = self.selected_resource == ResourceSelection::Resource
            && self.selected_mcp_resource_uri.as_deref() == Some(resource.uri.as_str());
        let response = egui::Frame::default()
            .fill(if selected {
                Color32::from_rgba_unmultiplied(30, 221, 214, 42)
            } else {
                Color32::from_rgba_unmultiplied(255, 255, 255, 8)
            })
            .stroke(Stroke::new(1.0, STROKE))
            .rounding(egui::Rounding::same(12.0))
            .inner_margin(egui::Margin::symmetric(12.0, 9.0))
            .show(ui, |ui| {
                ui.label(RichText::new(&label).strong().color(TEXT));
                ui.label(muted_text(&resource.uri).small());
            })
            .response
            .interact(egui::Sense::click());
        if response.clicked() {
            self.selected_resource = ResourceSelection::Resource;
            self.selected_mcp_resource_uri = Some(resource.uri.clone());
            self.right_open = true;
        }
    }

    fn mcp_prompt_button(&mut self, ui: &mut egui::Ui, prompt: &McpPrompt) {
        let selected = self.selected_resource == ResourceSelection::Prompt
            && self.selected_mcp_prompt_name.as_deref() == Some(prompt.name.as_str());
        let response = egui::Frame::default()
            .fill(if selected {
                Color32::from_rgba_unmultiplied(255, 184, 83, 38)
            } else {
                Color32::from_rgba_unmultiplied(255, 255, 255, 8)
            })
            .stroke(Stroke::new(1.0, STROKE))
            .rounding(egui::Rounding::same(12.0))
            .inner_margin(egui::Margin::symmetric(12.0, 9.0))
            .show(ui, |ui| {
                ui.label(RichText::new(&prompt.name).strong().color(TEXT));
                if let Some(description) = &prompt.description {
                    ui.label(muted_text(description).small());
                }
            })
            .response
            .interact(egui::Sense::click());
        if response.clicked() {
            self.selected_resource = ResourceSelection::Prompt;
            self.selected_mcp_prompt_name = Some(prompt.name.clone());
            self.right_open = true;
        }
    }

    fn selected_node_inspector(&mut self, ui: &mut egui::Ui) {
        let Some(node_id) = self.user_state.active_node else {
            return;
        };
        if !self.editor.graph.nodes.contains_key(node_id) {
            self.user_state.active_node = None;
            return;
        }

        ui.separator();
        ui.label(RichText::new("Active Node").strong());
        ui.monospace(self.node_remote_id(node_id));
        ui.label(format!("kind: {}", self.node_kind_label(node_id)));

        let mut title = self.node_title(node_id);
        ui.horizontal(|ui| {
            ui.label("title");
            if ui.text_edit_singleline(&mut title).changed() && self.set_node_title(node_id, title)
            {
                self.record_update_node(node_id);
            }
        });

        let is_component_slot = self
            .editor
            .graph
            .nodes
            .get(node_id)
            .is_some_and(|node| node.user_data.kind == WorkflowNodeTemplate::WebComponentSlot);
        if is_component_slot {
            let mut component = self.web_component_name(node_id).unwrap_or_default();
            ui.horizontal(|ui| {
                ui.label("component");
                if ui.text_edit_singleline(&mut component).changed()
                    && self.set_web_component_name(node_id, Some(component))
                {
                    self.component_snapshots.insert(
                        self.node_remote_id(node_id),
                        self.web_component_name(node_id),
                    );
                    self.record_update_node(node_id);
                }
            });
            ui.label(
                RichText::new("custom element name, e.g. lightflow-histogram-node")
                    .small()
                    .color(MUTED),
            );
        }
    }

    fn inspector(&mut self, ctx: &egui::Context) {
        if !self.right_open {
            return;
        }

        egui::Window::new("Inspector")
            .anchor(egui::Align2::RIGHT_TOP, egui::vec2(-16.0, 64.0))
            .default_width(380.0)
            .frame(
                egui::Frame::default()
                    .fill(Color32::from_rgba_unmultiplied(13, 20, 35, 238))
                    .stroke(Stroke::new(1.0, STROKE))
                    .rounding(egui::Rounding::same(18.0))
                    .inner_margin(egui::Margin::symmetric(18.0, 16.0)),
            )
            .resizable(true)
            .collapsible(true)
            .show(ctx, |ui| {
                ui.label(RichText::new("Inspector").strong().size(18.0).color(TEXT));
                ui.label(muted_text("Selection, transport and workflow diagnostics.").small());
                ui.add_space(10.0);
                ui.label(section_title("Settings"));
                ui.horizontal(|ui| {
                    ui.label("MCP");
                    ui.text_edit_singleline(&mut self.user_state.endpoint);
                });
                ui.label(RichText::new(&self.mcp_status).small().color(MUTED));
                if !self.pending_requests.is_empty() {
                    ui.label(format!("pending MCP calls: {}", self.pending_requests.len()));
                }
                ui.separator();
                ui.label(section_title("Selection"));
                match self.selected_resource {
                    ResourceSelection::McpFile => {
                        ui.label("mcp.json");
                        ui.label("The frontend calls backend MCP tools directly. It does not embed agent planning.");
                        ui.monospace("tools/call -> lightflow.workflow.*");
                    }
                    ResourceSelection::Workflow => {
                        ui.label(&self.workflow_id);
                        ui.label(format!("base revision: {}", self.base_revision));
                        ui.label(&self.dag_status);
                        ui.label(format!("loaded local nodes: {}", self.editor.graph.nodes.len()));
                        if let Some(total) = self.total_estimate {
                            ui.label(format!("backend total estimate: {total}"));
                        }
                        if let Some(region) = &self.loaded_region {
                            ui.label("loaded region");
                            ui.monospace(format!(
                                "x={} y={} w={} h={} z={:.2} limit={}",
                                region.x, region.y, region.width, region.height, region.zoom, region.limit
                            ));
                        }
                        ui.label(format!(
                            "next cursor: {}",
                            self.next_cursor.as_deref().unwrap_or("none")
                        ));
                        ui.label(format!(
                            "auto read visible: {}",
                            if self.auto_read_visible { "on" } else { "off" }
                        ));
                        ui.label(format!(
                            "window graph to region: {}",
                            if self.window_graph_to_region {
                                "on"
                            } else {
                                "off"
                            }
                        ));
                        ui.label(format!(
                            "current region nodes: {}",
                            self.visible_region_node_ids.len()
                        ));
                        ui.label(format!(
                            "stable viewport frames: {}",
                            self.stable_viewport_frames
                        ));
                    }
                    ResourceSelection::Tool => {
                        ui.label("tools/list");
                        ui.label("Discovers backend tools. No agent planner is embedded.");
                        if ui.add(ghost_button("Discover tools")).clicked() {
                            self.discover_mcp_tools();
                        }
                        if self.mcp_tools.is_empty() {
                            ui.label("No tools discovered yet.");
                        } else {
                            egui::ScrollArea::vertical()
                                .max_height(180.0)
                                .show(ui, |ui| {
                                    for tool in &self.mcp_tools {
                                        ui.monospace(tool);
                                    }
                                });
                        }
                    }
                    ResourceSelection::Resource => {
                        ui.label("resources/list");
                        ui.label("Discovers backend MCP resources for the explorer.");
                        if ui.add(ghost_button("Discover resources")).clicked() {
                            self.discover_mcp_resources();
                        }
                        if let Some(uri) = &self.selected_mcp_resource_uri {
                            ui.label("selected");
                            ui.monospace(uri);
                            if ui.add(accent_button("Read selected")).clicked() {
                                self.read_selected_mcp_resource();
                            }
                        }
                        if self.mcp_resources.is_empty() {
                            ui.label("No resources discovered yet.");
                        } else {
                            egui::ScrollArea::vertical()
                                .max_height(180.0)
                                .show(ui, |ui| {
                                    for resource in &self.mcp_resources {
                                        ui.monospace(resource.label());
                                    }
                                });
                        }
                        if !self.mcp_resource_preview.is_empty() {
                            ui.separator();
                            ui.label(RichText::new("Resource Preview").strong());
                            egui::ScrollArea::vertical()
                                .max_height(220.0)
                                .show(ui, |ui| {
                                    ui.monospace(&self.mcp_resource_preview);
                                });
                        }
                    }
                    ResourceSelection::Prompt => {
                        ui.label("prompts/list");
                        ui.label("Discovers backend MCP prompts for reusable instructions.");
                        if ui.add(ghost_button("Discover prompts")).clicked() {
                            self.discover_mcp_prompts();
                        }
                        if let Some(name) = &self.selected_mcp_prompt_name {
                            ui.label("selected");
                            ui.monospace(name);
                            if ui.add(accent_button("Get selected")).clicked() {
                                self.get_selected_mcp_prompt();
                            }
                        }
                        if self.mcp_prompts.is_empty() {
                            ui.label("No prompts discovered yet.");
                        } else {
                            egui::ScrollArea::vertical()
                                .max_height(180.0)
                                .show(ui, |ui| {
                                    for prompt in &self.mcp_prompts {
                                        ui.monospace(&prompt.name);
                                        if let Some(description) = &prompt.description {
                                            ui.label(
                                                RichText::new(description)
                                                    .small()
                                                    .color(MUTED),
                                            );
                                        }
                                    }
                                });
                        }
                        if !self.mcp_prompt_preview.is_empty() {
                            ui.separator();
                            ui.label(RichText::new("Prompt Preview").strong());
                            egui::ScrollArea::vertical()
                                .max_height(220.0)
                                .show(ui, |ui| {
                                    ui.monospace(&self.mcp_prompt_preview);
                                });
                        }
                    }
                    ResourceSelection::RunState => {
                        ui.label("lightflow://runs");
                        ui.label("Run manifests and status streams.");
                    }
                }
                self.selected_node_inspector(ui);
                ui.separator();
                ui.label(RichText::new("Architecture").strong());
                ui.label("Frontend core: Rust + egui + wgpu/WASM");
                ui.label("Graph state: petgraph DAG validation");
                ui.label("Persistence: MCP read_region + apply_patch");
                ui.label("Large workflow loading: viewport region + limit + cursor");
                ui.label("No Python bridge. No ComfyUI compatibility layer.");
                ui.separator();
                ui.label(RichText::new("Binary Data Plane").strong());
                ui.label("WebTransport datagrams carry FlatBuffers payloads.");
                ui.monospace(transport_summary());
                ui.separator();
                ui.label(RichText::new("Plugin Registry").strong());
                let plugin_nodes = plugin_node_summaries();
                if plugin_nodes.is_empty() {
                    ui.label("No Web Component nodes registered in this session.");
                } else {
                    for node in plugin_nodes {
                        ui.monospace(node);
                    }
                }
                let mounted_plugins = plugin_overlay_summaries();
                if !mounted_plugins.is_empty() {
                    ui.label("Mounted components");
                    for node in mounted_plugins {
                        ui.monospace(node);
                    }
                }
                if !self.dirty_ops.is_empty() {
                    ui.separator();
                    ui.label(RichText::new("Pending Patch").strong());
                    egui::ScrollArea::vertical()
                        .max_height(160.0)
                        .show(ui, |ui| {
                            for (index, op) in self.dirty_ops.iter().enumerate() {
                                ui.monospace(format!("{}: {:?}", index + 1, op));
                            }
                        });
                }
            });
    }

    fn sync_web_component_overlays(&self, editor_rect: egui::Rect) {
        let fallback_element_name = first_plugin_element_name();
        let zoom = self.editor.pan_zoom.zoom.max(0.01);
        let pan = self.editor.pan_zoom.pan + editor_rect.min.to_vec2();
        let mut live_node_ids = Vec::new();

        for node_id in self.editor.graph.iter_nodes() {
            let Some(node) = self.editor.graph.nodes.get(node_id) else {
                continue;
            };
            if node.user_data.kind != WorkflowNodeTemplate::WebComponentSlot {
                continue;
            }

            let Some(element_name) = self
                .web_component_name(node_id)
                .or_else(|| fallback_element_name.clone())
            else {
                continue;
            };

            let position = self
                .editor
                .node_positions
                .get(node_id)
                .copied()
                .unwrap_or(egui::Pos2::ZERO);
            let screen = position + pan;
            let remote_id = self.node_remote_id(node_id);
            live_node_ids.push(remote_id.clone());
            sync_plugin_component(
                &remote_id,
                &element_name,
                screen.x as f64,
                screen.y as f64,
                (220.0 * zoom) as f64,
                (132.0 * zoom) as f64,
                json!({
                    "nodeId": remote_id,
                    "workflowId": self.workflow_id,
                    "baseRevision": self.base_revision,
                    "component": element_name,
                    "selected": self.editor.selected_nodes.contains(&node_id),
                    "zoom": zoom,
                }),
            );
        }

        retain_plugin_components(&live_node_ids);
    }

    fn workflow_canvas(&mut self, ctx: &egui::Context) {
        egui::CentralPanel::default()
            .frame(egui::Frame::default().fill(BG))
            .show(ctx, |ui| {
                let rect = ui.max_rect();
                let painter = ui.painter_at(rect);
                painter.rect_filled(rect, 0.0, BG);
                painter.circle_filled(
                    rect.left_top() + egui::vec2(220.0, 90.0),
                    340.0,
                    Color32::from_rgba_unmultiplied(112, 86, 255, 28),
                );
                painter.circle_filled(
                    rect.right_top() + egui::vec2(-260.0, 160.0),
                    420.0,
                    Color32::from_rgba_unmultiplied(30, 221, 214, 22),
                );
                painter.circle_filled(
                    rect.center_bottom() + egui::vec2(120.0, -40.0),
                    360.0,
                    Color32::from_rgba_unmultiplied(255, 184, 83, 14),
                );

                let zoom = self.editor.pan_zoom.zoom.max(0.01);
                let pan = self.editor.pan_zoom.pan;
                let spacing = (44.0 * zoom).clamp(22.0, 88.0);
                let grid_color = Color32::from_rgba_unmultiplied(134, 161, 214, 20);
                let major_grid_color = Color32::from_rgba_unmultiplied(134, 161, 214, 36);
                let offset_x = pan.x.rem_euclid(spacing);
                let offset_y = pan.y.rem_euclid(spacing);
                let mut x = rect.left() + offset_x - spacing;
                let mut ix = 0;
                while x < rect.right() {
                    painter.line_segment(
                        [egui::pos2(x, rect.top()), egui::pos2(x, rect.bottom())],
                        Stroke::new(
                            1.0,
                            if ix % 4 == 0 {
                                major_grid_color
                            } else {
                                grid_color
                            },
                        ),
                    );
                    x += spacing;
                    ix += 1;
                }
                let mut y = rect.top() + offset_y - spacing;
                let mut iy = 0;
                while y < rect.bottom() {
                    painter.line_segment(
                        [egui::pos2(rect.left(), y), egui::pos2(rect.right(), y)],
                        Stroke::new(
                            1.0,
                            if iy % 4 == 0 {
                                major_grid_color
                            } else {
                                grid_color
                            },
                        ),
                    );
                    y += spacing;
                    iy += 1;
                }

                let response = self.editor.draw_graph_editor(
                    ui,
                    TemplateCatalog,
                    &mut self.user_state,
                    vec![],
                );
                for node_response in response.node_responses {
                    match node_response {
                        NodeResponse::User(WorkflowResponse::Inspect(node_id))
                        | NodeResponse::SelectNode(node_id) => {
                            self.user_state.active_node = Some(node_id);
                            self.selected_resource = ResourceSelection::Workflow;
                            self.right_open = true;
                        }
                        NodeResponse::ConnectEventEnded { output, input, .. } => {
                            let (from, to) = self.connection_refs(input, output);
                            self.push_dirty_op(WorkflowPatchOp::Connect { from, to });
                            self.update_dag_status();
                        }
                        NodeResponse::DisconnectEvent { output, input } => {
                            let (from, to) = self.connection_refs(input, output);
                            self.push_dirty_op(WorkflowPatchOp::Disconnect { from, to });
                            self.update_dag_status();
                        }
                        NodeResponse::DeleteNodeFull { node_id, .. } => {
                            self.push_dirty_op(WorkflowPatchOp::DeleteNode {
                                node_id: self.node_remote_id(node_id),
                            });
                            self.update_dag_status();
                        }
                        NodeResponse::CreatedNode(node_id) => {
                            self.push_dirty_op(WorkflowPatchOp::AddNode {
                                node: self.node_dto(node_id),
                            });
                            self.update_dag_status();
                        }
                        NodeResponse::MoveNode { node, .. } => {
                            self.record_move_node(node);
                        }
                        _ => {}
                    }
                }
                self.detect_component_patch_changes();
                self.sync_web_component_overlays(rect);
                self.observe_viewport_for_auto_read();

                let hud = egui::Rect::from_min_size(
                    rect.left_top() + egui::vec2(22.0, 22.0),
                    egui::vec2(310.0, 92.0),
                );
                painter.rect(
                    hud,
                    egui::Rounding::same(18.0),
                    Color32::from_rgba_unmultiplied(12, 18, 32, 210),
                    Stroke::new(1.0, STROKE),
                );
                painter.text(
                    hud.left_top() + egui::vec2(18.0, 15.0),
                    egui::Align2::LEFT_TOP,
                    "Workflow Canvas",
                    egui::FontId::proportional(18.0),
                    TEXT,
                );
                painter.text(
                    hud.left_top() + egui::vec2(18.0, 43.0),
                    egui::Align2::LEFT_TOP,
                    format!(
                        "{} nodes · {} ops · zoom {:.0}%",
                        self.editor.graph.nodes.len(),
                        self.dirty_ops.len(),
                        self.editor.pan_zoom.zoom * 100.0
                    ),
                    egui::FontId::proportional(13.0),
                    MUTED,
                );
                painter.circle_filled(hud.right_top() + egui::vec2(-32.0, 34.0), 8.0, GOOD);
                painter.text(
                    hud.right_top() + egui::vec2(-20.0, 24.0),
                    egui::Align2::LEFT_TOP,
                    "live",
                    egui::FontId::proportional(13.0),
                    GOOD,
                );
            });
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn send_mcp_request(endpoint: String, request: McpRequest, tx: Sender<McpTransportEvent>) {
    let _ = tx.send(McpTransportEvent {
        request_id: request.id,
        tool: request.label,
        result: Err(format!(
            "HTTP MCP transport is available in the WASM build; run Trunk and open the browser for {endpoint}"
        )),
    });
}

#[cfg(target_arch = "wasm32")]
fn send_mcp_request(endpoint: String, request: McpRequest, tx: Sender<McpTransportEvent>) {
    use wasm_bindgen::JsCast;
    use wasm_bindgen_futures::{spawn_local, JsFuture};

    spawn_local(async move {
        let request_id = request.id;
        let tool = request.label.clone();
        let result = async {
            let body = serde_json::to_string(&request).map_err(|err| err.to_string())?;
            let init = web_sys::RequestInit::new();
            init.set_method("POST");
            init.set_mode(web_sys::RequestMode::Cors);
            init.set_body(&wasm_bindgen::JsValue::from_str(&body));

            let request =
                web_sys::Request::new_with_str_and_init(&endpoint, &init).map_err(js_error)?;
            request
                .headers()
                .set("content-type", "application/json")
                .map_err(js_error)?;
            request
                .headers()
                .set("accept", "application/json")
                .map_err(js_error)?;

            let window = web_sys::window().ok_or_else(|| "missing window".to_owned())?;
            let response = JsFuture::from(window.fetch_with_request(&request))
                .await
                .map_err(js_error)?
                .dyn_into::<web_sys::Response>()
                .map_err(js_error)?;

            if !response.ok() {
                return Err(format!("HTTP {} from {endpoint}", response.status()));
            }

            let text = JsFuture::from(response.text().map_err(js_error)?)
                .await
                .map_err(js_error)?
                .as_string()
                .ok_or_else(|| "MCP response body is not text".to_owned())?;

            let value = serde_json::from_str::<Value>(&text).map_err(|err| err.to_string())?;
            if let Some(error) = value.get("error") {
                return Err(error
                    .get("message")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .unwrap_or_else(|| error.to_string()));
            }
            Ok(value)
        }
        .await;

        let _ = tx.send(McpTransportEvent {
            request_id,
            tool,
            result,
        });
    });
}

#[cfg(target_arch = "wasm32")]
fn js_error(value: wasm_bindgen::JsValue) -> String {
    value
        .as_string()
        .unwrap_or_else(|| "JavaScript error".to_owned())
}

impl eframe::App for LightFlowApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll_mcp_events();
        self.top_bar(ctx);
        self.resource_explorer(ctx);
        self.workflow_canvas(ctx);
        self.inspector(ctx);
    }
}
