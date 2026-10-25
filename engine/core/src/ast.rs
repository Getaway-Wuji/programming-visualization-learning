//! Flat, source-backed P0-C syntax trees and the STEP-01 node-map projection.
//!
//! Child edges are arena indices rather than owned nested nodes. Cloning,
//! comparing and dropping even a long expression therefore do not recursively
//! walk its syntax depth. This is an internal syntax model, not an EXEC result
//! or a claim that names, types, formats or execution have been validated.

use serde::Serialize;

use crate::budget::Meter;
use crate::diagnostic::{Diagnostic, Location, Stage};
use crate::source::ByteRange;

/// An index in a program's arena, scoped to that exact source revision.
pub type NodeId = usize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    pub data: NodeData,
    pub byte_range: ByteRange,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeData {
    Function {
        body: NodeId,
    },
    Block {
        statements: Vec<NodeId>,
    },
    Declaration {
        name: String,
        name_range: ByteRange,
        array_length: Option<i32>,
        initializer: Initializer,
    },
    Assignment {
        target: NodeId,
        value: NodeId,
    },
    If {
        condition: NodeId,
        then_block: NodeId,
        else_block: Option<NodeId>,
    },
    While {
        condition: NodeId,
        body: NodeId,
    },
    For {
        init: Option<NodeId>,
        condition: Option<NodeId>,
        update: Option<NodeId>,
        body: NodeId,
    },
    Condition {
        expression: NodeId,
    },
    Output {
        format: String,
        format_range: ByteRange,
        arguments: Vec<NodeId>,
    },
    Return {
        value: NodeId,
    },
    Break,
    Continue,
    Empty,
    Expr(Expression),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Initializer {
    None,
    Scalar(NodeId),
    Array(Vec<NodeId>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Expression {
    Integer(i32),
    Name(String),
    Index {
        array: NodeId,
        index: NodeId,
    },
    Unary {
        op: UnaryOp,
        operand: NodeId,
    },
    Binary {
        op: BinaryOp,
        left: NodeId,
        right: NodeId,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnaryOp {
    Plus,
    Minus,
    Not,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryOp {
    Multiply,
    Divide,
    Remainder,
    Add,
    Subtract,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    Equal,
    NotEqual,
    And,
    Or,
}

/// The closed STEP-01 node-kind vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Function,
    Block,
    Declaration,
    Assignment,
    Expression,
    Condition,
    Output,
    Return,
    Break,
    Continue,
    Empty,
    If,
    While,
    For,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeMapEntry {
    pub node_id: String,
    pub kind: NodeKind,
    pub parent_id: Option<String>,
    pub byte_range: ByteRange,
}

impl NodeData {
    /// Flat record traversal/copy cost, without allocating a children vector.
    pub(crate) fn entry_weight(&self) -> usize {
        1 + self.child_count()
            + match self {
                Self::Declaration { name, .. } | Self::Expr(Expression::Name(name)) => {
                    name.len().div_ceil(64)
                }
                Self::Output { format, .. } => format.len().div_ceil(64),
                _ => 0,
            }
    }

    pub(crate) fn child_count(&self) -> usize {
        match self {
            Self::Function { .. }
            | Self::Condition { .. }
            | Self::Return { .. }
            | Self::Expr(Expression::Unary { .. }) => 1,
            Self::Block { statements } => statements.len(),
            Self::Declaration { initializer, .. } => match initializer {
                Initializer::None => 0,
                Initializer::Scalar(_) => 1,
                Initializer::Array(values) => values.len(),
            },
            Self::Assignment { .. }
            | Self::While { .. }
            | Self::Expr(Expression::Index { .. } | Expression::Binary { .. }) => 2,
            Self::If { else_block, .. } => 2 + usize::from(else_block.is_some()),
            Self::For {
                init,
                condition,
                update,
                ..
            } => {
                1 + usize::from(init.is_some())
                    + usize::from(condition.is_some())
                    + usize::from(update.is_some())
            }
            Self::Output { arguments, .. } => arguments.len(),
            _ => 0,
        }
    }

    /// Direct children in syntactic preorder, independently of execution order.
    ///
    /// In particular a `for` header visits init, condition and update before its
    /// body; runtime control flow will execute the update after the body.
    pub fn children(&self) -> Vec<NodeId> {
        match self {
            Self::Function { body } => vec![*body],
            Self::Block { statements } => statements.clone(),
            Self::Declaration { initializer, .. } => match initializer {
                Initializer::None => Vec::new(),
                Initializer::Scalar(expression) => vec![*expression],
                Initializer::Array(expressions) => expressions.clone(),
            },
            Self::Assignment { target, value } => vec![*target, *value],
            Self::If {
                condition,
                then_block,
                else_block,
            } => {
                let mut children = vec![*condition, *then_block];
                children.extend(else_block);
                children
            }
            Self::While { condition, body } => vec![*condition, *body],
            Self::For {
                init,
                condition,
                update,
                body,
            } => init
                .iter()
                .chain(condition)
                .chain(update)
                .copied()
                .chain(std::iter::once(*body))
                .collect(),
            Self::Condition { expression } => vec![*expression],
            Self::Output { arguments, .. } => arguments.clone(),
            Self::Return { value } => vec![*value],
            Self::Expr(Expression::Index { array, index }) => vec![*array, *index],
            Self::Expr(Expression::Unary { operand, .. }) => vec![*operand],
            Self::Expr(Expression::Binary { left, right, .. }) => vec![*left, *right],
            Self::Break
            | Self::Continue
            | Self::Empty
            | Self::Expr(Expression::Integer(_) | Expression::Name(_)) => Vec::new(),
        }
    }

    pub fn kind(&self) -> NodeKind {
        match self {
            Self::Function { .. } => NodeKind::Function,
            Self::Block { .. } => NodeKind::Block,
            Self::Declaration { .. } => NodeKind::Declaration,
            Self::Assignment { .. } => NodeKind::Assignment,
            Self::If { .. } => NodeKind::If,
            Self::While { .. } => NodeKind::While,
            Self::For { .. } => NodeKind::For,
            Self::Condition { .. } => NodeKind::Condition,
            Self::Output { .. } => NodeKind::Output,
            Self::Return { .. } => NodeKind::Return,
            Self::Break => NodeKind::Break,
            Self::Continue => NodeKind::Continue,
            Self::Empty => NodeKind::Empty,
            Self::Expr(_) => NodeKind::Expression,
        }
    }

    fn remap_children(&mut self, remapping: &[NodeId]) {
        let remap = |id: &mut NodeId| *id = remapping[*id];
        match self {
            Self::Function { body } => remap(body),
            Self::Block { statements } => statements.iter_mut().for_each(remap),
            Self::Declaration { initializer, .. } => match initializer {
                Initializer::None => {}
                Initializer::Scalar(expression) => remap(expression),
                Initializer::Array(expressions) => expressions.iter_mut().for_each(remap),
            },
            Self::Assignment { target, value } => {
                remap(target);
                remap(value);
            }
            Self::If {
                condition,
                then_block,
                else_block,
            } => {
                remap(condition);
                remap(then_block);
                else_block.iter_mut().for_each(remap);
            }
            Self::While { condition, body } => {
                remap(condition);
                remap(body);
            }
            Self::For {
                init,
                condition,
                update,
                body,
            } => {
                init.iter_mut().for_each(remap);
                condition.iter_mut().for_each(remap);
                update.iter_mut().for_each(remap);
                remap(body);
            }
            Self::Condition { expression } => remap(expression),
            Self::Output { arguments, .. } => arguments.iter_mut().for_each(remap),
            Self::Return { value } => remap(value),
            Self::Expr(Expression::Index { array, index }) => {
                remap(array);
                remap(index);
            }
            Self::Expr(Expression::Unary { operand, .. }) => remap(operand),
            Self::Expr(Expression::Binary { left, right, .. }) => {
                remap(left);
                remap(right);
            }
            Self::Break
            | Self::Continue
            | Self::Empty
            | Self::Expr(Expression::Integer(_) | Expression::Name(_)) => {}
        }
    }
}

/// A parser-produced tree whose arena is stored in deterministic preorder.
///
/// This model contains only source syntax. The optional teaching header is
/// tracked separately because STEP-01 has no preprocessor node kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Program {
    pub nodes: Vec<Node>,
    pub root: NodeId,
    pub header_range: Option<ByteRange>,
}

impl Program {
    /// Move a trusted parser arena into preorder and rewrite every child index.
    ///
    /// The parser supplies one connected tree with ordered, containing ranges.
    /// Assertions identify internal construction bugs, not user diagnostics;
    /// this function must not be used to import arbitrary external arenas.
    /// Traversal and remapping are iterative, including for expression chains.
    pub fn from_arena(nodes: Vec<Node>, root: NodeId, header_range: Option<ByteRange>) -> Self {
        Self::from_arena_inner(nodes, root, header_range, None).expect("unmetered AST construction")
    }

    pub fn from_arena_metered(
        nodes: Vec<Node>,
        root: NodeId,
        header_range: Option<ByteRange>,
        meter: &mut Meter,
    ) -> Result<Self, Diagnostic> {
        Self::from_arena_inner(nodes, root, header_range, Some(meter))
    }

    fn from_arena_inner(
        nodes: Vec<Node>,
        root: NodeId,
        header_range: Option<ByteRange>,
        mut meter: Option<&mut Meter>,
    ) -> Result<Self, Diagnostic> {
        assert!(root < nodes.len(), "AST root must exist in the arena");
        ast_charge(&mut meter, nodes.len() + 1)?;
        let mut remapping = vec![usize::MAX; nodes.len()];
        let mut order = Vec::with_capacity(nodes.len());
        let mut pending = vec![root];

        while let Some(id) = pending.pop() {
            ast_charge(&mut meter, nodes[id].data.entry_weight())?;
            let node = nodes.get(id).expect("AST child must exist in the arena");
            assert_eq!(
                remapping[id],
                usize::MAX,
                "AST children must form a tree without shared nodes or cycles"
            );
            assert!(
                node.byte_range.start <= node.byte_range.end,
                "AST node range must be ordered"
            );
            remapping[id] = order.len();
            order.push(id);

            let children = node.data.children();
            for &child in &children {
                ast_charge(&mut meter, 1)?;
                let child_node = nodes.get(child).expect("AST child must exist in the arena");
                assert!(
                    contains(node.byte_range, child_node.byte_range),
                    "AST parent range must contain each child range"
                );
            }
            pending.extend(children.into_iter().rev());
        }
        assert_eq!(order.len(), nodes.len(), "AST arena has unreachable nodes");

        ast_charge(&mut meter, nodes.len())?;
        let mut original: Vec<Option<Node>> = nodes.into_iter().map(Some).collect();
        let mut reordered = Vec::with_capacity(order.len());
        for old_id in order {
            ast_charge(
                &mut meter,
                original[old_id].as_ref().unwrap().data.entry_weight(),
            )?;
            let mut node = original[old_id].take().expect("AST node is moved once");
            node.data.remap_children(&remapping);
            reordered.push(node);
        }

        Ok(Self {
            nodes: reordered,
            root: 0,
            header_range,
        })
    }

    pub fn node(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(id)
    }

    /// Project this source revision's preorder into STEP-01 `n1`, `n2`, ... IDs.
    ///
    /// Parents have containing source ranges. These IDs describe static syntax;
    /// later execution must allocate its own dynamic object/scope/frame IDs.
    pub fn node_map(&self) -> Vec<NodeMapEntry> {
        self.node_map_inner(None)
            .expect("unmetered node-map projection")
    }

    pub fn node_map_metered(&self, meter: &mut Meter) -> Result<Vec<NodeMapEntry>, Diagnostic> {
        self.node_map_inner(Some(meter))
    }

    fn node_map_inner(
        &self,
        mut meter: Option<&mut Meter>,
    ) -> Result<Vec<NodeMapEntry>, Diagnostic> {
        ast_charge(&mut meter, self.nodes.len())?;
        let mut parents = vec![None; self.nodes.len()];
        for (parent, node) in self.nodes.iter().enumerate() {
            ast_charge(&mut meter, node.data.entry_weight())?;
            for child in node.data.children() {
                assert!(
                    child > parent && child < self.nodes.len(),
                    "AST node-map projection requires a preorder tree"
                );
                assert!(
                    parents[child].replace(parent).is_none(),
                    "AST node-map projection requires one parent per child"
                );
                assert!(
                    contains(node.byte_range, self.nodes[child].byte_range),
                    "AST parent range must contain each child range"
                );
            }
        }

        let mut entries = Vec::new();
        for (id, node) in self.nodes.iter().enumerate() {
            ast_charge(&mut meter, 1)?;
            entries.push(NodeMapEntry {
                node_id: external_id(id),
                kind: node.data.kind(),
                parent_id: parents[id].map(external_id),
                byte_range: node.byte_range,
            });
        }
        Ok(entries)
    }
}

fn ast_charge(meter: &mut Option<&mut Meter>, units: usize) -> Result<(), Diagnostic> {
    if let Some(meter) = meter.as_deref_mut() {
        meter.charge(units).map_err(|error| {
            error.diagnostic(
                Stage::Parse,
                Location::Synthetic {
                    reason: "pre-execution",
                },
            )
        })?;
    }
    Ok(())
}

fn contains(parent: ByteRange, child: ByteRange) -> bool {
    parent.start <= child.start && child.start <= child.end && child.end <= parent.end
}

fn external_id(id: NodeId) -> String {
    format!("n{}", id + 1)
}

#[cfg(test)]
mod tests {
    use super::{BinaryOp, Expression, Initializer, Node, NodeData, NodeKind, Program, UnaryOp};
    use crate::source::ByteRange;
    use serde_json::json;

    fn node(data: NodeData, start: usize, end: usize) -> Node {
        Node {
            data,
            byte_range: ByteRange { start, end },
        }
    }

    #[test]
    fn arena_moves_to_preorder_and_remaps_nested_expression_edges() {
        // Construction order deliberately differs from syntax order.
        let original = vec![
            node(NodeData::Expr(Expression::Integer(2)), 12, 13),
            node(NodeData::Expr(Expression::Name("x".into())), 8, 9),
            node(
                NodeData::Expr(Expression::Binary {
                    op: BinaryOp::Add,
                    left: 1,
                    right: 0,
                }),
                8,
                13,
            ),
            node(NodeData::Return { value: 2 }, 1, 14),
            node(
                NodeData::Block {
                    statements: vec![3],
                },
                0,
                15,
            ),
            node(NodeData::Function { body: 4 }, 0, 15),
        ];
        let program = Program::from_arena(original, 5, None);
        assert_eq!(program.root, 0);
        assert_eq!(program.nodes.len(), 6);
        assert_eq!(
            program.node(0).unwrap().data,
            NodeData::Function { body: 1 }
        );
        assert_eq!(
            program.node(1).unwrap().data,
            NodeData::Block {
                statements: vec![2]
            }
        );
        assert_eq!(program.node(2).unwrap().data, NodeData::Return { value: 3 });
        assert_eq!(
            program.node(3).unwrap().data,
            NodeData::Expr(Expression::Binary {
                op: BinaryOp::Add,
                left: 4,
                right: 5,
            })
        );
        assert_eq!(
            program.node(4).unwrap().data,
            NodeData::Expr(Expression::Name("x".into()))
        );
        assert_eq!(
            program.node(5).unwrap().data,
            NodeData::Expr(Expression::Integer(2))
        );
        assert!(program.node(6).is_none());
        let parents: Vec<_> = program
            .node_map()
            .into_iter()
            .map(|entry| (entry.node_id, entry.parent_id))
            .collect();
        assert_eq!(
            parents,
            vec![
                ("n1".into(), None),
                ("n2".into(), Some("n1".into())),
                ("n3".into(), Some("n2".into())),
                ("n4".into(), Some("n3".into())),
                ("n5".into(), Some("n4".into())),
                ("n6".into(), Some("n4".into())),
            ]
        );
    }

    #[test]
    fn child_order_preserves_source_order_for_control_and_initializer_forms() {
        assert_eq!(
            NodeData::For {
                init: Some(7),
                condition: Some(4),
                update: Some(8),
                body: 2,
            }
            .children(),
            vec![7, 4, 8, 2]
        );
        assert_eq!(
            NodeData::For {
                init: None,
                condition: None,
                update: None,
                body: 2,
            }
            .children(),
            vec![2]
        );
        assert_eq!(
            NodeData::If {
                condition: 4,
                then_block: 2,
                else_block: Some(7),
            }
            .children(),
            vec![4, 2, 7]
        );
        assert_eq!(
            NodeData::Assignment {
                target: 4,
                value: 2
            }
            .children(),
            vec![4, 2]
        );
        let mut declaration = NodeData::Declaration {
            name: "a".into(),
            name_range: ByteRange { start: 4, end: 5 },
            array_length: Some(3),
            initializer: Initializer::Array(vec![5, 1, 8]),
        };
        assert_eq!(declaration.children(), vec![5, 1, 8]);
        declaration.remap_children(&[0, 7, 2, 3, 4, 6, 5, 1, 8]);
        assert_eq!(declaration.children(), vec![6, 7, 8]);
    }

    #[test]
    fn remapping_updates_every_child_bearing_node_variant() {
        let mut forms = vec![
            NodeData::Function { body: 2 },
            NodeData::Block {
                statements: vec![2, 0],
            },
            NodeData::Declaration {
                name: "x".into(),
                name_range: ByteRange { start: 4, end: 5 },
                array_length: None,
                initializer: Initializer::Scalar(2),
            },
            NodeData::Assignment {
                target: 2,
                value: 0,
            },
            NodeData::If {
                condition: 2,
                then_block: 0,
                else_block: Some(1),
            },
            NodeData::While {
                condition: 2,
                body: 0,
            },
            NodeData::For {
                init: Some(2),
                condition: Some(0),
                update: Some(1),
                body: 3,
            },
            NodeData::Condition { expression: 2 },
            NodeData::Output {
                format: "%d".into(),
                format_range: ByteRange { start: 7, end: 11 },
                arguments: vec![2, 0],
            },
            NodeData::Return { value: 2 },
            NodeData::Expr(Expression::Index { array: 2, index: 0 }),
            NodeData::Expr(Expression::Unary {
                op: UnaryOp::Minus,
                operand: 2,
            }),
            NodeData::Expr(Expression::Binary {
                op: BinaryOp::Multiply,
                left: 2,
                right: 0,
            }),
        ];
        let expected = [
            vec![7],
            vec![7, 8],
            vec![7],
            vec![7, 8],
            vec![7, 8, 9],
            vec![7, 8],
            vec![7, 8, 9, 6],
            vec![7],
            vec![7, 8],
            vec![7],
            vec![7, 8],
            vec![7],
            vec![7, 8],
        ];
        for (form, expected) in forms.iter_mut().zip(expected) {
            form.remap_children(&[8, 9, 7, 6]);
            assert_eq!(form.children(), expected);
        }
    }

    #[test]
    fn node_map_has_closed_kind_names_and_camel_case_fields() {
        let program = Program::from_arena(
            vec![
                node(NodeData::Empty, 20, 21),
                node(
                    NodeData::Block {
                        statements: vec![0],
                    },
                    19,
                    22,
                ),
                node(NodeData::Function { body: 1 }, 10, 22),
            ],
            2,
            Some(ByteRange { start: 0, end: 9 }),
        );
        assert_eq!(program.header_range, Some(ByteRange { start: 0, end: 9 }));
        assert_eq!(
            serde_json::to_value(program.node_map()).unwrap(),
            json!([
                {"nodeId": "n1", "kind": "function", "parentId": null,
                 "byteRange": {"start": 10, "end": 22}},
                {"nodeId": "n2", "kind": "block", "parentId": "n1",
                 "byteRange": {"start": 19, "end": 22}},
                {"nodeId": "n3", "kind": "empty", "parentId": "n2",
                 "byteRange": {"start": 20, "end": 21}}
            ])
        );
        let kinds = [
            NodeKind::Function,
            NodeKind::Block,
            NodeKind::Declaration,
            NodeKind::Assignment,
            NodeKind::Expression,
            NodeKind::Condition,
            NodeKind::Output,
            NodeKind::Return,
            NodeKind::Break,
            NodeKind::Continue,
            NodeKind::Empty,
            NodeKind::If,
            NodeKind::While,
            NodeKind::For,
        ];
        assert_eq!(
            serde_json::to_value(kinds).unwrap(),
            json!([
                "function",
                "block",
                "declaration",
                "assignment",
                "expression",
                "condition",
                "output",
                "return",
                "break",
                "continue",
                "empty",
                "if",
                "while",
                "for"
            ])
        );
    }

    #[test]
    fn long_chain_is_reordered_cloned_compared_and_dropped_iteratively() {
        // Deliberately test beyond the parser's valid expression depth. The
        // arena is also used while rejecting such source and must drop safely.
        let mut nodes = vec![node(NodeData::Expr(Expression::Integer(1)), 0, 1)];
        for operand in 0..20_000 {
            nodes.push(node(
                NodeData::Expr(Expression::Unary {
                    op: UnaryOp::Plus,
                    operand,
                }),
                0,
                1,
            ));
        }
        let program = Program::from_arena(nodes, 20_000, None);
        assert_eq!(program.nodes.len(), 20_001);
        assert_eq!(program.node_map().len(), 20_001);
        let copied = program.clone();
        assert_eq!(program, copied);
        drop(program);
        drop(copied);
    }
}
