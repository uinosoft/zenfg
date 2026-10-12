use crate::{FrameGraphError, compiler::AllocationKey, execution::NativeResource};
use std::collections::HashMap;

/// Copyable runtime-owned partition identity. It owns no GPU resources and remains valid after clearing.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct ResourcePoolScope {
    owner: u64,
    index: u64,
}

impl core::fmt::Debug for ResourcePoolScope {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("ResourcePoolScope(..)")
    }
}

impl ResourcePoolScope {
    pub(crate) fn new(owner: u64, index: u64) -> Self {
        Self { owner, index }
    }
    pub(crate) fn belongs_to(self, owner: u64) -> bool {
        self.owner == owner
    }
}

/// Borrowed physical allocation specifications without labels, GPU objects or internal keys.
#[derive(Clone, Copy, Debug)]
pub enum PoolAllocationDescriptor<'a> {
    /// Rounded physical buffer capacity and effective native usage.
    Buffer {
        /// Pool capacity, not logical size.
        size: u64,
        /// Native usage.
        usage: wgpu::BufferUsages,
    },
    /// Normalized physical texture specifications.
    Texture {
        /// Allocation extent.
        size: wgpu::Extent3d,
        /// Native format.
        format: wgpu::TextureFormat,
        /// Native dimension.
        dimension: wgpu::TextureDimension,
        /// Mip count.
        mip_level_count: u32,
        /// Sample count.
        sample_count: u32,
        /// Normalized alternate formats.
        view_formats: &'a [wgpu::TextureFormat],
        /// Native usage.
        usage: wgpu::TextureUsages,
    },
}

impl<'a> From<&'a AllocationKey> for PoolAllocationDescriptor<'a> {
    fn from(key: &'a AllocationKey) -> Self {
        match key {
            AllocationKey::Buffer { size, usage } => Self::Buffer {
                size: *size,
                usage: *usage,
            },
            AllocationKey::Texture {
                size,
                format,
                dimension,
                mip_level_count,
                sample_count,
                view_formats,
                usage,
            } => Self::Texture {
                size: wgpu::Extent3d {
                    width: size.0,
                    height: size.1,
                    depth_or_array_layers: size.2,
                },
                format: *format,
                dimension: *dimension,
                mip_level_count: *mip_level_count,
                sample_count: *sample_count,
                view_formats,
                usage: *usage,
            },
        }
    }
}

/// Callback-local readonly view of one retained instance; contains no persistent instance identity.
#[derive(Clone, Copy, Debug)]
pub struct ResourcePoolEntryInfo<'a> {
    /// Partition identity, or None for the default shared domain.
    pub scope: Option<ResourcePoolScope>,
    /// Descriptor-based estimate, not measured resident GPU memory.
    pub estimated_bytes: u64,
    /// Accepted executions since acquisition; unrelated to application frame indices.
    pub unused_executions: u64,
    /// Borrowed physical specifications.
    pub descriptor: PoolAllocationDescriptor<'a>,
}

/// Cache removals selected by explicit eviction; not immediate freed VRAM.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ResourcePoolEvictionReport {
    /// Removed physical instances, counting aliased resources once.
    pub evicted_count: u64,
    /// Sum of removed instances' byte estimates.
    pub estimated_evicted_bytes: u64,
}

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

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct PoolKey {
    allocation: AllocationKey,
    scope: Option<ResourcePoolScope>,
}

#[derive(Debug)]
struct PoolEntry {
    native: NativeResource,
    estimated_bytes: u64,
    last_acquired_execution: u64,
}

#[derive(Debug, Default)]
pub(crate) struct ResourcePool {
    buckets: HashMap<PoolKey, Vec<PoolEntry>>,
    stats: ResourcePoolStats,
    execution_serial: u64,
}

impl ResourcePool {
    pub(crate) fn stats(&self) -> ResourcePoolStats {
        self.stats
    }

    pub(crate) fn begin_execution(&mut self) -> Result<(), FrameGraphError> {
        self.execution_serial =
            self.execution_serial
                .checked_add(1)
                .ok_or_else(|| FrameGraphError::Internal {
                    message: "resource pool execution serial exhausted".into(),
                })?;
        Ok(())
    }

    fn acquire(
        &mut self,
        device: &wgpu::Device,
        key: &PoolKey,
        label: &str,
        estimated_bytes: u64,
    ) -> PoolEntry {
        self.stats.acquire_count = self.stats.acquire_count.saturating_add(1);
        if let Some(mut entry) = self.buckets.get_mut(key).and_then(Vec::pop) {
            self.stats.reuse_count = self.stats.reuse_count.saturating_add(1);
            self.stats.retained_count = self.stats.retained_count.saturating_sub(1);
            self.stats.estimated_retained_bytes = self
                .stats
                .estimated_retained_bytes
                .saturating_sub(entry.estimated_bytes);
            entry.last_acquired_execution = self.execution_serial;
            return entry;
        }
        self.stats.created_count = self.stats.created_count.saturating_add(1);
        let native = match &key.allocation {
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
                dimension: *dimension,
                mip_level_count: *mip_level_count,
                sample_count: *sample_count,
                format: *format,
                view_formats,
                usage: *usage,
            })),
        };
        PoolEntry {
            native,
            estimated_bytes,
            last_acquired_execution: self.execution_serial,
        }
    }

    fn release(&mut self, key: PoolKey, entry: PoolEntry) {
        self.stats.retained_count = self.stats.retained_count.saturating_add(1);
        self.stats.estimated_retained_bytes = self
            .stats
            .estimated_retained_bytes
            .saturating_add(entry.estimated_bytes);
        self.buckets.entry(key).or_default().push(entry);
    }

    pub(crate) fn evict<F>(&mut self, mut predicate: F) -> ResourcePoolEvictionReport
    where
        F: FnMut(&ResourcePoolEntryInfo<'_>) -> bool,
    {
        // Unwinding during selection drops only these decisions, without mutating the pool.
        let selection: Vec<_> = self
            .buckets
            .iter()
            .map(|(key, entries)| {
                let decisions: Vec<_> = entries
                    .iter()
                    .map(|entry| {
                        predicate(&ResourcePoolEntryInfo {
                            scope: key.scope,
                            estimated_bytes: entry.estimated_bytes,
                            unused_executions: self.execution_serial
                                - entry.last_acquired_execution,
                            descriptor: (&key.allocation).into(),
                        })
                    })
                    .collect();
                (key.clone(), decisions)
            })
            .collect();
        let mut removed = Vec::new();
        let mut report = ResourcePoolEvictionReport::default();
        for (key, decisions) in selection {
            let entries = self.buckets.get_mut(&key).expect("selected bucket exists");
            let original = std::mem::take(entries);
            for (entry, selected) in original.into_iter().zip(decisions) {
                if selected {
                    report.evicted_count = report.evicted_count.saturating_add(1);
                    report.estimated_evicted_bytes = report
                        .estimated_evicted_bytes
                        .saturating_add(entry.estimated_bytes);
                    removed.push(entry.native);
                } else {
                    entries.push(entry);
                }
            }
        }
        self.buckets.retain(|_, entries| !entries.is_empty());
        self.stats.retained_count = self
            .stats
            .retained_count
            .saturating_sub(report.evicted_count);
        self.stats.estimated_retained_bytes = self
            .stats
            .estimated_retained_bytes
            .saturating_sub(report.estimated_evicted_bytes);
        for native in removed {
            native.destroy();
        }
        report
    }

    pub(crate) fn clear(&mut self) {
        self.evict(|_| true);
    }
}

impl Drop for ResourcePool {
    fn drop(&mut self) {
        self.clear();
    }
}

pub(crate) struct TransientResourceLease<'pool> {
    pool: &'pool mut ResourcePool,
    acquired: Vec<(PoolKey, PoolEntry)>,
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
        scope: Option<ResourcePoolScope>,
        label: &str,
        estimated_byte_size: u64,
    ) -> NativeResource {
        let key = PoolKey {
            allocation: key.clone(),
            scope,
        };
        let entry = self.pool.acquire(device, &key, label, estimated_byte_size);
        let native = entry.native.clone();
        self.acquired.push((key, entry));
        native
    }
}

impl Drop for TransientResourceLease<'_> {
    fn drop(&mut self) {
        for (key, entry) in self.acquired.drain(..) {
            self.pool.release(key, entry);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn eviction_removes_empty_bucket_metadata_and_preserves_counters() {
        let (device, _queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
        let mut pool = ResourcePool::default();
        pool.begin_execution().unwrap();
        let key = PoolKey {
            allocation: AllocationKey::Buffer {
                size: 64,
                usage: wgpu::BufferUsages::COPY_DST,
            },
            scope: None,
        };
        let entry = pool.acquire(&device, &key, "", 64);
        pool.release(key, entry);
        let before = pool.stats();
        assert_eq!(pool.evict(|_| true).evicted_count, 1);
        assert!(pool.buckets.is_empty());
        assert_eq!(pool.stats().acquire_count, before.acquire_count);
        assert_eq!(pool.stats().created_count, before.created_count);
        assert_eq!(pool.stats().estimated_retained_bytes, 0);
    }
}
