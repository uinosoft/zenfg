use core::{marker::PhantomData, ops::Range};

use crate::{FrameGraphError, ResourceId, ViewId};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum ResourceOrigin {
    Transient,
    Imported,
    Surface,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum InitialContents {
    Defined,
    Undefined,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum UsagePolicy<U> {
    Infer,
    Fixed(U),
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TextureDesc {
    pub label: String,
    pub size: wgpu::Extent3d,
    pub mip_level_count: u32,
    pub sample_count: u32,
    pub dimension: wgpu::TextureDimension,
    pub format: wgpu::TextureFormat,
    pub view_formats: Vec<wgpu::TextureFormat>,
    pub usage: UsagePolicy<wgpu::TextureUsages>,
}

impl TextureDesc {
    pub fn new_2d(
        label: impl Into<String>,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> Self {
        Self {
            label: label.into(),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            view_formats: Vec::new(),
            usage: UsagePolicy::Infer,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BufferDesc {
    pub label: String,
    pub size: u64,
    pub usage: UsagePolicy<wgpu::BufferUsages>,
}

impl BufferDesc {
    pub fn new(label: impl Into<String>, size: u64) -> Self {
        Self {
            label: label.into(),
            size,
            usage: UsagePolicy::Infer,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ImportTextureOptions {
    pub initial_contents: InitialContents,
    pub exposed_usage: Option<wgpu::TextureUsages>,
}

impl ImportTextureOptions {
    pub const fn new(initial_contents: InitialContents) -> Self {
        Self {
            initial_contents,
            exposed_usage: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ImportBufferOptions {
    pub initial_contents: InitialContents,
    pub exposed_usage: Option<wgpu::BufferUsages>,
}

impl ImportBufferOptions {
    pub const fn new(initial_contents: InitialContents) -> Self {
        Self {
            initial_contents,
            exposed_usage: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BufferRange {
    pub offset: u64,
    pub size: Option<u64>,
}

impl BufferRange {
    pub const fn new(offset: u64, size: u64) -> Self {
        Self {
            offset,
            size: Some(size),
        }
    }

    pub const fn whole() -> Self {
        Self {
            offset: 0,
            size: None,
        }
    }

    pub(crate) fn resolve(
        self,
        resource: ResourceId,
        resource_size: u64,
    ) -> Result<Range<u64>, FrameGraphError> {
        let size = self
            .size
            .unwrap_or_else(|| resource_size.saturating_sub(self.offset));
        let end = self
            .offset
            .checked_add(size)
            .ok_or(FrameGraphError::InvalidBufferRange {
                resource,
                offset: self.offset,
                end: u64::MAX,
                resource_size,
            })?;
        if self.offset > resource_size || end > resource_size {
            return Err(FrameGraphError::InvalidBufferRange {
                resource,
                offset: self.offset,
                end,
                resource_size,
            });
        }
        Ok(self.offset..end)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TextureSubresourceRange {
    pub base_mip_level: u32,
    pub mip_level_count: u32,
    pub base_slice: u32,
    pub slice_count: u32,
    pub aspect: wgpu::TextureAspect,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TextureViewDesc {
    pub label: String,
    pub format: Option<wgpu::TextureFormat>,
    pub dimension: Option<wgpu::TextureViewDimension>,
    pub aspect: wgpu::TextureAspect,
    pub base_mip_level: u32,
    pub mip_level_count: Option<u32>,
    pub base_array_layer: u32,
    pub array_layer_count: Option<u32>,
}

/// Fully resolved recording-time metadata for a logical texture view.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct NormalizedTextureViewDesc {
    pub label: String,
    pub format: wgpu::TextureFormat,
    pub dimension: wgpu::TextureViewDimension,
    pub aspect: wgpu::TextureAspect,
    pub base_mip_level: u32,
    pub mip_level_count: u32,
    pub base_array_layer: u32,
    pub array_layer_count: Option<u32>,
}

impl Default for TextureViewDesc {
    fn default() -> Self {
        Self {
            label: String::new(),
            format: None,
            dimension: None,
            aspect: wgpu::TextureAspect::All,
            base_mip_level: 0,
            mip_level_count: None,
            base_array_layer: 0,
            array_layer_count: None,
        }
    }
}

pub(crate) fn normalize_texture_view_descriptor(
    texture: &TextureDesc,
    view: &TextureViewDesc,
) -> NormalizedTextureViewDesc {
    let dimension = view.dimension.unwrap_or(match texture.dimension {
        wgpu::TextureDimension::D1 => wgpu::TextureViewDimension::D1,
        wgpu::TextureDimension::D2 if texture.size.depth_or_array_layers == 1 => {
            wgpu::TextureViewDimension::D2
        }
        wgpu::TextureDimension::D2 => wgpu::TextureViewDimension::D2Array,
        wgpu::TextureDimension::D3 => wgpu::TextureViewDimension::D3,
    });
    let mip_level_count = view
        .mip_level_count
        .unwrap_or(texture.mip_level_count - view.base_mip_level);
    let array_layer_count = if texture.dimension == wgpu::TextureDimension::D3 {
        None
    } else {
        Some(
            view.array_layer_count
                .unwrap_or(texture.size.depth_or_array_layers - view.base_array_layer),
        )
    };
    NormalizedTextureViewDesc {
        label: view.label.clone(),
        format: view.format.unwrap_or(texture.format),
        dimension,
        aspect: if texture.format.has_depth_aspect() {
            wgpu::TextureAspect::DepthOnly
        } else {
            wgpu::TextureAspect::All
        },
        base_mip_level: view.base_mip_level,
        mip_level_count,
        base_array_layer: view.base_array_layer,
        array_layer_count,
    }
}

macro_rules! define_handle {
    ($name:ident, $id:ty) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub struct $name<'frame> {
            pub(crate) id: $id,
            pub(crate) owner: u64,
            pub(crate) recording: u64,
            pub(crate) marker: PhantomData<fn(&'frame mut ()) -> &'frame mut ()>,
        }

        impl $name<'_> {
            pub const fn id(self) -> $id {
                self.id
            }
        }
    };
}

define_handle!(Texture, ResourceId);
define_handle!(TextureView, ViewId);
define_handle!(Buffer, ResourceId);

/// One ordered zero-fill operation in a structured clear-buffer node.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClearBufferOp<'frame> {
    pub target: Buffer<'frame>,
    pub range: BufferRange,
}

impl<'frame> ClearBufferOp<'frame> {
    pub const fn new(target: Buffer<'frame>, range: BufferRange) -> Self {
        Self { target, range }
    }
}

/// One logical texture subresource location used by a declarative copy operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct TextureCopyLocation<'frame> {
    pub texture: Texture<'frame>,
    pub mip_level: u32,
    pub origin: wgpu::Origin3d,
    pub aspect: wgpu::TextureAspect,
}

impl<'frame> TextureCopyLocation<'frame> {
    pub const fn new(texture: Texture<'frame>) -> Self {
        Self {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        }
    }
}

/// One logical buffer and texel layout used by a buffer-texture copy operation.
#[derive(Clone, Copy, Debug)]
pub struct BufferTextureCopyLocation<'frame> {
    pub buffer: Buffer<'frame>,
    pub layout: wgpu::TexelCopyBufferLayout,
}

impl<'frame> BufferTextureCopyLocation<'frame> {
    pub const fn new(buffer: Buffer<'frame>, layout: wgpu::TexelCopyBufferLayout) -> Self {
        Self { buffer, layout }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TextureTarget<'frame> {
    Texture(Texture<'frame>),
    View(TextureView<'frame>),
}

impl<'frame> From<Texture<'frame>> for TextureTarget<'frame> {
    fn from(value: Texture<'frame>) -> Self {
        Self::Texture(value)
    }
}

impl<'frame> From<TextureView<'frame>> for TextureTarget<'frame> {
    fn from(value: TextureView<'frame>) -> Self {
        Self::View(value)
    }
}
