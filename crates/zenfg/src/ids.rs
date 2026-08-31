use core::fmt;

macro_rules! define_id {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
        #[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
        #[repr(transparent)]
        pub struct $name(u32);

        impl $name {
            pub(crate) const fn new(value: u32) -> Self {
                Self(value)
            }

            /// Returns the capture-local numeric identity.
            pub const fn get(self) -> u32 {
                self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}

define_id!(
    /// Recording-local identity of a logical resource.
    ResourceId
);
define_id!(
    /// Recording-local identity of a logical texture view.
    ViewId
);
define_id!(
    /// Recording-local identity of a graph node/pass.
    PassId
);
define_id!(
    /// Recording-local identity of a declared resource access.
    AccessId
);
define_id!(
    /// Recording-local identity of a logical content value.
    ValueId
);
define_id!(
    /// Compilation-local identity of a physical allocation.
    AllocationId
);
define_id!(
    /// Recording-local identity of a diagnostic debug group.
    DebugGroupId
);
