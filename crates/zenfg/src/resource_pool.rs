use std::collections::HashMap;

use crate::{compiler::AllocationKey, execution::NativeResource};

/// Aggregate counters for the FrameGraph-owned transient resource pool.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ResourcePoolStats {
    /// Number of physical transient allocation requests.
    pub acquire_count: u64,
    /// Number of allocation requests served by a retained native resource.
    pub reuse_count: u64,
    /// Number of native resources created by the pool.
    pub created_count: u64,
    /// Number of native resources currently retained for reuse.
    pub retained_count: u64,
    /// Estimated bytes represented by currently retained resources.
    pub estimated_retained_bytes: u64,
}

#[derive(Debug, Default)]
pub(crate) struct ResourcePool {
    buckets: HashMap<AllocationKey, Vec<NativeResource>>,
    stats: ResourcePoolStats,
}

impl ResourcePool {
    pub(crate) fn stats(&self) -> ResourcePoolStats {
        self.stats
    }

    pub(crate) fn acquire(
        &mut self,
        device: &wgpu::Device,
        key: &AllocationKey,
        label: &str,
        estimated_byte_size: u64,
    ) -> NativeResource {
        self.stats.acquire_count = self.stats.acquire_count.saturating_add(1);
        if let Some(resource) = self.buckets.get_mut(key).and_then(Vec::pop) {
            self.stats.reuse_count = self.stats.reuse_count.saturating_add(1);
            self.stats.retained_count = self.stats.retained_count.saturating_sub(1);
            self.stats.estimated_retained_bytes = self
                .stats
                .estimated_retained_bytes
                .saturating_sub(estimated_byte_size);
            return resource;
        }

        self.stats.created_count = self.stats.created_count.saturating_add(1);
        match key {
            AllocationKey::Buffer { size, usage } => {
                NativeResource::Buffer(device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some(label),
                    size: *size,
                    usage: *usage,
                    mapped_at_creation: false,
                }))
            }
            AllocationKey::Texture {
                format,
                size,
                dimension,
                mip_level_count,
                sample_count,
                view_formats,
                usage,
            } => NativeResource::Texture(device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: size.0,
                    height: size.1,
                    depth_or_array_layers: size.2,
                },
                mip_level_count: *mip_level_count,
                sample_count: *sample_count,
                dimension: *dimension,
                format: *format,
                usage: *usage,
                view_formats,
            })),
        }
    }

    fn release(&mut self, key: AllocationKey, resource: NativeResource, estimated_byte_size: u64) {
        self.buckets.entry(key).or_default().push(resource);
        self.stats.retained_count = self.stats.retained_count.saturating_add(1);
        self.stats.estimated_retained_bytes = self
            .stats
            .estimated_retained_bytes
            .saturating_add(estimated_byte_size);
    }

    pub(crate) fn clear(&mut self) {
        for resource in self.buckets.drain().flat_map(|(_, resources)| resources) {
            resource.destroy();
        }
        self.stats.retained_count = 0;
        self.stats.estimated_retained_bytes = 0;
    }
}

impl Drop for ResourcePool {
    fn drop(&mut self) {
        self.clear();
    }
}

pub(crate) struct TransientResourceLease<'pool> {
    pool: &'pool mut ResourcePool,
    acquired: Vec<(AllocationKey, NativeResource, u64)>,
}

impl<'pool> TransientResourceLease<'pool> {
    pub(crate) fn new(pool: &'pool mut ResourcePool) -> Self {
        Self {
            pool,
            acquired: Vec::new(),
        }
    }

    pub(crate) fn acquire(
        &mut self,
        device: &wgpu::Device,
        key: &AllocationKey,
        label: &str,
        estimated_byte_size: u64,
    ) -> NativeResource {
        let resource = self.pool.acquire(device, key, label, estimated_byte_size);
        self.acquired
            .push((key.clone(), resource.clone(), estimated_byte_size));
        resource
    }
}

impl Drop for TransientResourceLease<'_> {
    fn drop(&mut self) {
        for (key, resource, estimated_byte_size) in self.acquired.drain(..) {
            self.pool.release(key, resource, estimated_byte_size);
        }
    }
}
