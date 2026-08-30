use core::ops::Range;

use crate::{
    AccessId, AccessMode, AccessRole, BufferDesc, DebugGroupId, NodeKind, PassId,
    ResourceDescriptor, ResourceId, ResourceKind, ResourceOrigin, ResourceRange, RootReason,
    TextureDesc, TextureSubresourceRange, TextureViewDesc, ValueId, ViewId,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum NormalizedRange {
    Buffer(Range<u64>),
    Texture(Vec<TextureSubresourceRange>),
}

impl NormalizedRange {
    pub(crate) fn report(&self) -> ResourceRange {
        match self {
            Self::Buffer(range) => ResourceRange::Buffer(crate::BufferRange::new(
                range.start,
                range.end - range.start,
            )),
            Self::Texture(regions) => ResourceRange::Texture(regions.clone()),
        }
    }

    pub(crate) fn overlaps(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Buffer(a), Self::Buffer(b)) => a.start < b.end && b.start < a.end,
            (Self::Texture(a), Self::Texture(b)) => a.iter().any(|left| {
                b.iter().any(|right| {
                    left.base_mip_level == right.base_mip_level
                        && left.aspect == right.aspect
                        && left.base_slice < right.base_slice + right.slice_count
                        && right.base_slice < left.base_slice + left.slice_count
                })
            }),
            _ => false,
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        match self {
            Self::Buffer(range) => range.is_empty(),
            Self::Texture(regions) => regions.iter().all(|region| region.slice_count == 0),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ResourceRecord {
    pub id: ResourceId,
    pub origin: ResourceOrigin,
    pub initial_contents: crate::InitialContents,
    pub descriptor: ResourceDescriptor,
    pub exposed_texture_usage: Option<wgpu::TextureUsages>,
    pub exposed_buffer_usage: Option<wgpu::BufferUsages>,
    pub debug_group: Option<DebugGroupId>,
}

impl ResourceRecord {
    pub(crate) fn kind(&self) -> ResourceKind {
        match self.descriptor {
            ResourceDescriptor::Texture(_) => ResourceKind::Texture,
            ResourceDescriptor::Buffer(_) => ResourceKind::Buffer,
        }
    }

    pub(crate) fn label(&self) -> &str {
        match &self.descriptor {
            ResourceDescriptor::Texture(desc) => &desc.label,
            ResourceDescriptor::Buffer(desc) => &desc.label,
        }
    }

    pub(crate) fn texture(&self) -> Option<&TextureDesc> {
        match &self.descriptor {
            ResourceDescriptor::Texture(desc) => Some(desc),
            ResourceDescriptor::Buffer(_) => None,
        }
    }

    pub(crate) fn buffer(&self) -> Option<&BufferDesc> {
        match &self.descriptor {
            ResourceDescriptor::Buffer(desc) => Some(desc),
            ResourceDescriptor::Texture(_) => None,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ViewRecord {
    pub id: ViewId,
    pub texture: ResourceId,
    pub descriptor: TextureViewDesc,
    pub range: NormalizedRange,
}

#[derive(Clone, Debug)]
pub(crate) struct AccessRecord {
    pub id: AccessId,
    pub pass: PassId,
    pub resource: ResourceId,
    pub role: AccessRole,
    pub mode: AccessMode,
    pub consumes_previous: bool,
    pub produces_value: bool,
    pub range: NormalizedRange,
    pub view: Option<ViewId>,
    pub value: Option<ValueId>,
}

#[derive(Clone, Debug)]
pub(crate) struct NodeRecord {
    pub id: PassId,
    pub kind: NodeKind,
    pub label: String,
    pub side_effect: bool,
    pub accesses: Vec<AccessRecord>,
    pub debug_group: Option<DebugGroupId>,
}

#[derive(Clone, Debug)]
pub(crate) struct DebugGroupRecord {
    pub id: DebugGroupId,
    pub parent: Option<DebugGroupId>,
    pub label: String,
}

#[derive(Clone, Debug)]
pub(crate) struct RootRecord {
    pub resource: ResourceId,
    pub reason: RootReason,
    pub range: NormalizedRange,
}
