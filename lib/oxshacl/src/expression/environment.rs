use super::NodeExpression;
use oxrdf::vocab::xsd;
use oxrdf::{Term, Variable};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum ArgumentBinding {
    Expression(NodeExpression),
    Values(Vec<Term>),
}

/// One custom-function argument together with the RDF key that names it.
///
/// The key is retained so SPARQL-backed bodies can pre-bind the argument as a
/// scope variable.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ScopeArgument {
    pub key: Term,
    pub binding: ArgumentBinding,
}

/// Variable and custom-function bindings visible to a node expression.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ExpressionEnvironment {
    bindings: BTreeMap<String, Term>,
    explicitly_unbound: BTreeSet<String>,
    arguments: BTreeMap<String, ScopeArgument>,
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
        self.arguments.get(key).map(|argument| &argument.binding)
    }

    pub(super) fn with_arguments(&self, arguments: BTreeMap<String, ScopeArgument>) -> Self {
        let mut environment = self.clone();
        environment.arguments = arguments;
        environment
    }

    pub(super) fn without_arguments(&self) -> Self {
        let mut environment = self.clone();
        environment.arguments.clear();
        environment
    }

    /// Builds the argument scope of a custom function called from SPARQL.
    ///
    /// Each entry maps a `shnex:argN` key to the argument's value, or to
    /// `None` when the caller supplied no argument in that position. An absent
    /// value is retained as an empty binding so `shnex:arg` yields no node and
    /// a SPARQL-backed body sees the variable as unbound.
    #[cfg(feature = "sparql")]
    pub(crate) fn with_positional_arguments(&self, arguments: Vec<(Term, Option<Term>)>) -> Self {
        let arguments = arguments
            .into_iter()
            .map(|(key, value)| {
                (
                    crate::path::term_key(&key),
                    ScopeArgument {
                        key,
                        binding: ArgumentBinding::Values(value.into_iter().collect()),
                    },
                )
            })
            .collect();
        self.with_arguments(arguments)
    }

    /// Returns the already-evaluated scope arguments as SPARQL pre-bindings.
    ///
    /// Expression-valued arguments belong to named-parameter functions, whose
    /// bodies re-evaluate them through `shnex:arg`; only list-parameter
    /// arguments are eagerly evaluated and therefore pre-bindable. An argument
    /// that produced no term stays absent so the SPARQL variable is unbound.
    #[cfg(feature = "sparql")]
    pub(crate) fn scope_substitutions(&self) -> Vec<(Variable, Term)> {
        self.arguments
            .values()
            .filter_map(|argument| {
                let ArgumentBinding::Values(values) = &argument.binding else {
                    return None;
                };
                let name = scope_variable_name(&argument.key)?;
                let value = values.first()?;
                Some((Variable::new_unchecked(name), value.clone()))
            })
            .collect()
    }

    /// Returns every scope variable name, including those left unbound.
    #[cfg(feature = "sparql")]
    pub(crate) fn scope_variables(&self) -> Vec<Variable> {
        self.arguments
            .values()
            .filter(|argument| matches!(argument.binding, ArgumentBinding::Values(_)))
            .filter_map(|argument| scope_variable_name(&argument.key).map(Variable::new_unchecked))
            .collect()
    }
}

/// Maps a scope key to its pre-bound SPARQL variable name.
///
/// Per shacl12-sparql SelectExpression-evaluation, a string-literal name is
/// used verbatim and any other name becomes `"arg" + str(name)`, so the
/// `xsd:integer` keys of a list-parameter function yield `arg0`, `arg1`, ....
/// `this` is reserved for the focus node and is reported as a failure by the
/// caller rather than silently shadowing it.
#[cfg(feature = "sparql")]
fn scope_variable_name(key: &Term) -> Option<String> {
    let name = match key {
        Term::Literal(literal) if *literal.datatype() == xsd::STRING => literal.value().to_owned(),
        Term::Literal(literal) => format!("arg{}", literal.value()),
        Term::NamedNode(node) => format!("arg{node}"),
        Term::BlankNode(_) => return None,
        #[cfg(feature = "rdf-12")]
        Term::Triple(_) => return None,
    };
    Variable::new(name.clone()).is_ok().then_some(name)
}
