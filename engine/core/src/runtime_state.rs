//! Live int/array objects for the trusted, semantically checked P0-C executor.
//!
//! Static declaration nodes resolve to the currently live dynamic object. Names
//! are descriptive only: shadowing never replaces another declaration's value.
//! Scope/object IDs and teaching addresses are monotonic within each run.
//! They are projected into STEP-01, never host pointers. The executor leaves scopes after successful
//! control flow; a failed operation can retain its live state for later tracing.
//! This module does not import or validate arbitrary external state or ASTs.

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::ast::NodeId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeState {
    pub scopes: Vec<RuntimeScope>,
    pub variables: BTreeMap<NodeId, RuntimeVariable>,
    pub arrays: BTreeMap<NodeId, RuntimeArray>,
    /// Logical int slots, including uninitialized slots and empty placeholders.
    pub live_bytes: usize,
    pub output: String,
    pub next_scope_id: u64,
    pub next_object_id: u64,
    /// Monotonic teaching-only logical address; never a host address.
    pub next_address: u64,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            scopes: Vec::new(),
            variables: BTreeMap::new(),
            arrays: BTreeMap::new(),
            live_bytes: 0,
            output: String::new(),
            next_scope_id: 1,
            next_object_id: 1,
            next_address: 4096,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RuntimeScope {
    pub id: u64,
    pub node_id: NodeId,
    pub declaration_nodes: Vec<NodeId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RuntimeVariable {
    pub id: u64,
    pub declaration_node: NodeId,
    pub scope_id: u64,
    pub name: String,
    pub value: Option<i32>,
    pub base_address: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeArray {
    pub id: u64,
    pub declaration_node: NodeId,
    pub scope_id: u64,
    pub name: String,
    pub length: usize,
    /// Missing cells inherit this value; None denotes uninitialized storage.
    pub default_value: Option<i32>,
    pub cells: Arc<BTreeMap<usize, i32>>,
    pub base_address: u64,
}

impl RuntimeState {
    /// Enter one dynamic block or `for` scope, including repeated loop bodies.
    pub(crate) fn enter_scope(&mut self, node_id: NodeId) {
        let id = self.next_scope_id;
        self.next_scope_id = id
            .checked_add(1)
            .expect("runtime scope IDs must not exhaust");
        self.scopes.push(RuntimeScope {
            id,
            node_id,
            declaration_nodes: Vec::new(),
        });
    }

    /// Destroy only objects owned by the innermost dynamic scope.
    pub(crate) fn leave_scope(&mut self) {
        let scope = self.scopes.pop().expect("runtime must leave a live scope");
        for declaration in scope.declaration_nodes {
            let (scope_id, bytes) = if let Some(variable) = self.variables.remove(&declaration) {
                (variable.scope_id, 4)
            } else {
                let array = self
                    .arrays
                    .remove(&declaration)
                    .expect("live scope owns live object");
                (array.scope_id, array.length * 4)
            };
            assert_eq!(
                scope_id, scope.id,
                "live declaration must belong to its owning scope"
            );
            self.live_bytes -= bytes;
        }
    }

    /// Create an uninitialized scalar before evaluating its initializer.
    pub(crate) fn declare(&mut self, declaration_node: NodeId, name: String) {
        let scope = self
            .scopes
            .last_mut()
            .expect("runtime declaration must have a live scope");
        assert!(
            !self.variables.contains_key(&declaration_node),
            "a static declaration cannot have two live instances in P0-C"
        );
        let id = self.next_object_id;
        self.next_object_id = id
            .checked_add(1)
            .expect("runtime object IDs must not exhaust");
        self.variables.insert(
            declaration_node,
            RuntimeVariable {
                id,
                declaration_node,
                scope_id: scope.id,
                name,
                value: None,
                base_address: self.next_address,
            },
        );
        scope.declaration_nodes.push(declaration_node);
        self.live_bytes += 4;
        self.next_address += 4;
    }

    /// The executor checks capacity arithmetic and live budget before this call.
    pub(crate) fn declare_array(&mut self, declaration_node: NodeId, name: String, length: usize) {
        let scope = self
            .scopes
            .last_mut()
            .expect("array declaration has live scope");
        assert!(!self.arrays.contains_key(&declaration_node));
        assert!(!self.variables.contains_key(&declaration_node));
        let id = self.next_object_id;
        self.next_object_id = id.checked_add(1).expect("bounded runtime object identity");
        self.arrays.insert(
            declaration_node,
            RuntimeArray {
                id,
                declaration_node,
                scope_id: scope.id,
                name,
                length,
                default_value: None,
                cells: Arc::new(BTreeMap::new()),
                base_address: self.next_address,
            },
        );
        scope.declaration_nodes.push(declaration_node);
        self.live_bytes += length * 4;
        self.next_address += length as u64 * 4;
    }

    /// Commit a successful whole literal-list initializer, including zero fill.
    pub(crate) fn initialize_array(&mut self, declaration_node: NodeId, values: Vec<i32>) {
        let array = self
            .arrays
            .get_mut(&declaration_node)
            .expect("live checked array");
        assert!(values.len() <= array.length);
        let cells = values
            .into_iter()
            .enumerate()
            .filter(|(_, value)| *value != 0)
            .collect();
        array.default_value = Some(0);
        array.cells = Arc::new(cells);
    }

    /// The executor has already checked the actual declared capacity.
    pub(crate) fn read_array(&self, declaration_node: NodeId, index: usize) -> Option<i32> {
        let array = self
            .arrays
            .get(&declaration_node)
            .expect("live checked array");
        assert!(index < array.length);
        array.cells.get(&index).copied().or(array.default_value)
    }

    pub(crate) fn write_array(&mut self, declaration_node: NodeId, index: usize, value: i32) {
        let array = self
            .arrays
            .get_mut(&declaration_node)
            .expect("live checked array");
        assert!(index < array.length);
        if array.default_value == Some(value) {
            Arc::make_mut(&mut array.cells).remove(&index);
        } else {
            Arc::make_mut(&mut array.cells).insert(index, value);
        }
    }

    /// Read by semantic declaration identity, never by a potentially shared name.
    ///
    /// `None` denotes an uninitialized or absent object; checked control flow
    /// guarantees that a referenced declaration is live before reading it.
    pub(crate) fn read(&self, declaration_node: NodeId) -> Option<i32> {
        self.variables
            .get(&declaration_node)
            .and_then(|variable| variable.value)
    }

    /// Commit a successful scalar initialization or assignment.
    pub(crate) fn write(&mut self, declaration_node: NodeId, value: i32) {
        self.variables
            .get_mut(&declaration_node)
            .expect("runtime write must target a live declaration")
            .value = Some(value);
    }
}

#[cfg(test)]
mod tests {
    use super::RuntimeState;

    #[test]
    fn default_state_is_empty_and_identity_sequences_begin_at_one() {
        let state = RuntimeState::default();
        assert!(state.scopes.is_empty());
        assert!(state.variables.is_empty());
        assert!(state.output.is_empty());
        assert_eq!(state.next_scope_id, 1);
        assert_eq!(state.next_object_id, 1);
    }

    #[test]
    fn declaration_is_uninitialized_until_a_successful_write() {
        let mut state = RuntimeState::default();
        state.enter_scope(1);
        state.declare(2, "x".into());

        assert_eq!(state.read(2), None);
        assert_eq!(state.variables[&2].value, None);
        assert_eq!(state.variables[&2].scope_id, state.scopes[0].id);
        assert_eq!(state.scopes[0].declaration_nodes, vec![2]);

        state.write(2, i32::MIN);
        assert_eq!(state.read(2), Some(i32::MIN));
        state.write(2, 0);
        assert_eq!(state.read(2), Some(0));
    }

    #[test]
    fn shadowed_names_keep_distinct_declaration_bindings() {
        let mut state = RuntimeState::default();
        state.enter_scope(1);
        state.declare(2, "x".into());
        state.write(2, 7);
        state.enter_scope(3);
        state.declare(4, "x".into());

        // A self-initializer for the inner declaration must see no value,
        // although a same-name outer object has already been initialized.
        assert_eq!(state.read(4), None);
        assert_eq!(state.read(2), Some(7));
        state.write(4, 9);
        state.write(2, 11);
        assert_eq!(state.read(4), Some(9));
        assert_eq!(state.read(2), Some(11));

        state.leave_scope();
        assert!(!state.variables.contains_key(&4));
        assert_eq!(state.read(2), Some(11));
        assert_eq!(state.variables.len(), 1);
    }

    #[test]
    fn repeated_declaration_execution_gets_fresh_identity_and_initialization() {
        let mut state = RuntimeState::default();
        state.enter_scope(1);
        state.declare(2, "x".into());
        state.write(2, 42);
        let first_scope = state.scopes[0].id;
        let first_object = state.variables[&2].id;
        state.leave_scope();
        assert!(state.scopes.is_empty());
        assert!(state.variables.is_empty());

        state.enter_scope(1);
        state.declare(2, "x".into());
        assert!(state.scopes[0].id > first_scope);
        assert!(state.variables[&2].id > first_object);
        assert_eq!(state.variables[&2].declaration_node, 2);
        assert_eq!(state.read(2), None);
        assert_eq!(state.next_scope_id, 3);
        assert_eq!(state.next_object_id, 3);
    }

    #[test]
    fn loop_body_exit_preserves_for_binding_and_output_until_its_own_exit() {
        let mut state = RuntimeState::default();
        state.enter_scope(1);
        state.enter_scope(2);
        state.declare(3, "i".into());
        state.write(3, 0);
        state.output.push_str("开始\n");

        for iteration in 0..2 {
            state.enter_scope(4);
            state.declare(5, "local".into());
            state.write(5, iteration);
            let snapshot = state.clone();
            assert_eq!(snapshot, state);
            assert_eq!(snapshot.scopes.len(), 3);
            state.leave_scope();
            assert!(!state.variables.contains_key(&5));
            assert_eq!(state.read(3), Some(iteration));
            state.write(3, iteration + 1);
        }

        assert_eq!(state.read(3), Some(2));
        state.leave_scope();
        assert!(state.variables.is_empty());
        assert_eq!(state.scopes.len(), 1);
        assert_eq!(state.output, "开始\n");
        state.leave_scope();
        assert!(state.scopes.is_empty());
        assert_eq!(state.output, "开始\n");
    }
}
