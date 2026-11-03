//! Independently versioned, bounded teaching C interpreter. No host C execution.
pub use c_viz_core::{budget, codec, source};
pub mod api;
pub mod check;
pub mod edit;
mod eval;
pub mod formats;
pub mod judge;
mod library;
pub mod runtime;
pub mod state;
mod statements;
pub mod syntax;
pub mod types;

pub use api::execute;
