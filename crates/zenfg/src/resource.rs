use core::{marker::PhantomData, ops::Range};

use crate::{FrameGraphError, ResourceId, ViewId};

/// Ownership and allocation source of a logical resource.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum ResourceOrigin {
    /// FrameGraph allocates the resource for retained work and may alias it.
    Transient,
    /// The caller owns and binds a native resource.
    Imported,
    /// The caller owns and presents an acquired surface texture.
    Surface,
}

/// Whether an imported resource contains readable data at frame start.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum InitialContents {
    /// Reads and preserving writes may consume the initial contents.
    Defined,
    /// A full overwrite must occur before any read or preserving write.
    Undefined,
}

/// Policy used to choose native wgpu usage flags for a transient resource.
///
/// Imported-resource availability is declared separately with
/// [`ImportTextureOptions::exposed_usage`] or [`ImportBufferOptions::exposed_usage`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum UsagePolicy<U> {
    /// Infer the smallest usage set required by retained graph accesses.
    Infer,
    /// Allocate a transient with exactly these flags and reject incompatible retained work.
    Fixed(U),
}

/// Logical texture descriptor used for validation and transient allocation.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TextureDesc {
    /// Diagnostic label copied to native transient allocations.
    pub label: String,
    /// Texture dimensions and array/depth extent.
    pub size: wgpu::Extent3d,
    /// Number of mip levels; must be non-zero and fit the texture size.
    pub mip_level_count: u32,
    /// Multisample count; must be supported by wgpu for the selected format.
    pub sample_count: u32,
    /// Texture dimensionality.
    pub dimension: wgpu::TextureDimension,
    /// Texel format.
    pub format: wgpu::TextureFormat,
    /// Additional formats permitted when creating texture views.
    pub view_formats: Vec<wgpu::TextureFormat>,
    /// Whether usage is inferred from retained work or fixed by the caller.
    pub usage: UsagePolicy<wgpu::TextureUsages>,
}

impl TextureDesc {
    /// Creates a single-mip, single-sample 2D descriptor with inferred usage.
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

/// Logical buffer descriptor used for validation and transient allocation.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BufferDesc {
    /// Diagnostic label copied to native transient allocations.
    pub label: String,
    /// Logical size in bytes.
    pub size: u64,
    /// Whether usage is inferred from retained work or fixed by the caller.
    pub usage: UsagePolicy<wgpu::BufferUsages>,
}

impl BufferDesc {
    /// Creates a buffer descriptor with inferred usage.
    pub fn new(label: impl Into<String>, size: u64) -> Self {
        Self {
            label: label.into(),
            size,
            usage: UsagePolicy::Infer,
        }
    }
}

/// Initial-content and native-usage contract for an imported texture.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ImportTextureOptions {
    /// Whether the caller guarantees readable contents at frame start.
    pub initial_contents: InitialContents,
    /// Native usage exposed to the graph, or `None` to infer retained requirements.
    pub exposed_usage: Option<wgpu::TextureUsages>,
}

impl ImportTextureOptions {
    /// Creates import options with no explicit native usage restriction.
    pub const fn new(initial_contents: InitialContents) -> Self {
        Self {
            initial_contents,
            exposed_usage: None,
        }
    }
}

/// Initial-content and native-usage contract for an imported buffer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ImportBufferOptions {
    /// Whether the caller guarantees readable contents at frame start.
    pub initial_contents: InitialContents,
    /// Native usage exposed to the graph, or `None` to infer retained requirements.
    pub exposed_usage: Option<wgpu::BufferUsages>,
}

impl ImportBufferOptions {
    /// Creates import options with no explicit native usage restriction.
    pub const fn new(initial_contents: InitialContents) -> Self {
        Self {
            initial_contents,
            exposed_usage: None,
        }
    }
}

/// A byte range within a logical buffer.
///
/// `size: None` means all bytes from `offset` to the logical end of the buffer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BufferRange {
    /// First byte in the range.
    pub offset: u64,
    /// Number of bytes, or `None` for the remaining buffer.
    pub size: Option<u64>,
}

impl BufferRange {
    /// Creates an explicit `offset..offset + size` byte range.
    pub const fn new(offset: u64, size: u64) -> Self {
        Self {
            offset,
            size: Some(size),
        }
    }

    /// Selects the entire buffer.
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

/// One normalized texture subresource range.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TextureSubresourceRange {
    /// First selected mip level.
    pub base_mip_level: u32,
    /// Number of selected mip levels.
    pub mip_level_count: u32,
    /// First array layer or 3D depth slice.
    pub base_slice: u32,
    /// Number of selected layers or slices.
    pub slice_count: u32,
    /// Selected texture aspect.
    pub aspect: wgpu::TextureAspect,
}

/// Descriptor for a logical texture view.
///
/// Optional counts extend from their base through the remaining texture
/// subresources. Optional format and dimension use wgpu-compatible defaults.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TextureViewDesc {
    /// Diagnostic view label.
    pub label: String,
    /// View format, or the underlying texture format when omitted.
    pub format: Option<wgpu::TextureFormat>,
    /// View dimension, or the dimension inferred from the texture when omitted.
    pub dimension: Option<wgpu::TextureViewDimension>,
    /// Selected texture aspect.
    pub aspect: wgpu::TextureAspect,
    /// First selected mip level.
    pub base_mip_level: u32,
    /// Selected mip count, or all remaining mips.
    pub mip_level_count: Option<u32>,
    /// First selected array layer.
    pub base_array_layer: u32,
    /// Selected array-layer count, or all remaining layers.
    pub array_layer_count: Option<u32>,
}

/// Fully resolved recording-time metadata for a logical texture view.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct NormalizedTextureViewDesc {
    /// Diagnostic view label.
    pub label: String,
    /// Fully resolved view format.
    pub format: wgpu::TextureFormat,
    /// Fully resolved view dimension.
    pub dimension: wgpu::TextureViewDimension,
    /// Fully resolved texture aspect.
    pub aspect: wgpu::TextureAspect,
    /// First selected mip level.
    pub base_mip_level: u32,
    /// Number of selected mip levels.
    pub mip_level_count: u32,
    /// First selected array layer.
    pub base_array_layer: u32,
    /// Selected layers, or `None` for a 3D view whose slices vary by mip.
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
    ($(#[$meta:meta])* $name:ident, $id:ty) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub struct $name<'frame> {
            pub(crate) id: $id,
            pub(crate) owner: u64,
            pub(crate) recording: u64,
            pub(crate) marker: PhantomData<fn(&'frame mut ()) -> &'frame mut ()>,
        }

        impl $name<'_> {
            /// Returns the recording-local numeric identity used in reports and errors.
            pub const fn id(self) -> $id {
                self.id
            }
        }
    };
}

define_handle!(
    /// Typed handle to one logical texture in a single frame recording.
    ///
    /// The lifetime prevents use after the recording is compiled. Runtime owner
    /// checks additionally reject handles from another graph or recording.
    Texture,
    ResourceId
);
define_handle!(
    /// Typed handle to one normalized logical texture view in a single recording.
    TextureView,
    ViewId
);
define_handle!(
    /// Typed handle to one logical buffer in a single frame recording.
    Buffer,
    ResourceId
);

/// One ordered zero-fill operation in a structured clear-buffer node.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClearBufferOp<'frame> {
    /// Logical buffer to clear.
    pub target: Buffer<'frame>,
    /// Non-empty, four-byte-aligned byte range to clear.
    pub range: BufferRange,
}

impl<'frame> ClearBufferOp<'frame> {
    /// Creates one declarative zero-fill operation.
    pub const fn new(target: Buffer<'frame>, range: BufferRange) -> Self {
        Self { target, range }
    }
}

/// One logical texture subresource location used by a declarative copy operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct TextureCopyLocation<'frame> {
    /// Logical source or destination texture.
    pub texture: Texture<'frame>,
    /// Selected mip level.
    pub mip_level: u32,
    /// Texel origin within the selected mip.
    pub origin: wgpu::Origin3d,
    /// Selected texture aspect.
    pub aspect: wgpu::TextureAspect,
}

impl<'frame> TextureCopyLocation<'frame> {
    /// Selects mip 0 at the zero origin and all available aspects.
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
    /// Logical source or destination buffer.
    pub buffer: Buffer<'frame>,
    /// Texel-copy layout within the buffer.
    pub layout: wgpu::TexelCopyBufferLayout,
}

impl<'frame> BufferTextureCopyLocation<'frame> {
    /// Creates a logical buffer copy location with an explicit texel layout.
    pub const fn new(buffer: Buffer<'frame>, layout: wgpu::TexelCopyBufferLayout) -> Self {
        Self { buffer, layout }
    }
}

/// A whole logical texture or an explicitly created logical view.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TextureTarget<'frame> {
    /// Use the texture's default full view.
    Texture(Texture<'frame>),
    /// Use the selected logical view and subresource range.
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
