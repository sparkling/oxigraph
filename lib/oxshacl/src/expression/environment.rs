use super::NodeExpression;
use oxrdf::Term;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum ArgumentBinding {
    Expression(NodeExpression),
    Values(Vec<Term>),
}

/// Variable and custom-function bindings visible to a node expression.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ExpressionEnvironment {
    bindings: BTreeMap<String, Term>,
    explicitly_unbound: BTreeSet<String>,
    arguments: BTreeMap<String, ArgumentBinding>,
}

impl ExpressionEnvironment {
    /// Binds `name` to `value`, replacing any previous binding or explicit unbind.
    pub fn insert(&mut self, name: impl Into<String>, value: Term) {
        let name = name.into();
        self.explicitly_unbound.remove(&name);
        self.bindings.insert(name, value);
    }

    /// Removes a binding and marks `name` explicitly unbound.
    ///
    /// Explicit unbinding prevents the special `focusNode` fallback.
    pub fn unbind(&mut self, name: impl Into<String>) {
        let name = name.into();
        self.bindings.remove(&name);
        self.explicitly_unbound.insert(name);
    }

    /// Returns the term bound to `name`, if any.
    pub fn get(&self, name: &str) -> Option<&Term> {
        self.bindings.get(name)
    }

    pub(super) fn is_explicitly_unbound(&self, name: &str) -> bool {
        self.explicitly_unbound.contains(name)
    }

    pub(super) fn argument(&self, key: &str) -> Option<&ArgumentBinding> {
        self.arguments.get(key)
    }

    pub(super) fn with_arguments(&self, arguments: BTreeMap<String, ArgumentBinding>) -> Self {
        let mut environment = self.clone();
        environment.arguments = arguments;
        environment
    }

    pub(super) fn without_arguments(&self) -> Self {
        let mut environment = self.clone();
        environment.arguments.clear();
        environment
    }
}
