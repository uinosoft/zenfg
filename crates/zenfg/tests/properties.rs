use proptest::prelude::*;
use zenfg::{
    BufferDesc, BufferRange, CompileOptions, FrameGraph, ResourceDescriptor, RootReason,
    TextureDesc, TextureViewDesc, WriteContents,
};

proptest! {
    #[test]
    fn buffer_dependency_coverage_matches_a_byte_oracle(
        ranges in prop::collection::vec((0u8..8, 0u8..8), 0..16)
    ) {
        let normalized: Vec<_> = ranges.into_iter()
            .map(|(a, b)| (a.min(b), a.max(b) + 1))
            .collect();
        let mut covered = [false; 8];
        for (start, end) in &normalized {
            for byte in *start..(*end).min(8) {
                covered[byte as usize] = true;
            }
        }

        let mut graph = FrameGraph::new();
        let mut frame = graph.begin_frame();
        let buffer = frame.create_buffer(BufferDesc::new("buffer", 8)).unwrap();
        for (index, (start, end)) in normalized.iter().enumerate() {
            let mut pass = frame.compute_pass(format!("write-{index}"));
            let _ = pass.storage_buffer_write(
                buffer,
                BufferRange::new(*start as u64, (*end - *start) as u64),
                WriteContents::Overwrite,
            ).unwrap();
            pass.finish().unwrap();
        }
        let mut reader = frame.command_pass("read-all");
        let _ = reader.storage_buffer_read(buffer, BufferRange::whole()).unwrap();
        reader.finish().unwrap();
        let result = frame.compile(CompileOptions::default());
        prop_assert_eq!(result.is_ok(), covered.iter().all(|value| *value));
        if let Err(error) = result {
            prop_assert_eq!(error.code(), "FG1001");
        }
    }

    #[test]
    fn texture_layer_coverage_matches_a_cell_oracle(mask in 0u8..16) {
        let mut graph = FrameGraph::new();
        let mut frame = graph.begin_frame();
        let mut desc = TextureDesc::new_2d("array", 8, 8, wgpu::TextureFormat::Rgba8Unorm);
        desc.size.depth_or_array_layers = 4;
        let texture = frame.create_texture(desc).unwrap();
        for layer in 0..4 {
            if mask & (1 << layer) == 0 {
                continue;
            }
            let view = frame.create_texture_view(texture, TextureViewDesc {
                label: format!("layer-{layer}"),
                base_array_layer: layer,
                array_layer_count: Some(1),
                ..Default::default()
            }).unwrap();
            let mut pass = frame.compute_pass(format!("write-{layer}"));
            let _ = pass.storage_texture_write(view, WriteContents::Overwrite).unwrap();
            pass.finish().unwrap();
        }
        let mut reader = frame.command_pass("read-all");
        let _ = reader.sampled_texture(texture).unwrap();
        reader.finish().unwrap();
        let result = frame.compile(CompileOptions::default());
        prop_assert_eq!(result.is_ok(), mask == 0b1111);
    }

    #[test]
    fn every_retained_transient_has_one_compatible_non_overlapping_allocation(
        sizes in prop::collection::vec(1u16..257, 1..20)
    ) {
        let mut graph = FrameGraph::new();
        let mut frame = graph.begin_frame();
        for (index, size) in sizes.iter().copied().enumerate() {
            let buffer = frame
                .create_buffer(BufferDesc::new(format!("buffer-{index}"), u64::from(size)))
                .unwrap();
            let mut pass = frame.compute_pass(format!("write-{index}"));
            let _ = pass.storage_buffer_write(
                buffer,
                BufferRange::whole(),
                WriteContents::Overwrite,
            ).unwrap();
            pass.finish().unwrap();
            frame.mark_buffer_root(buffer, BufferRange::whole(), RootReason::Output).unwrap();
        }

        let compiled = frame.compile(CompileOptions::full_report()).unwrap();
        let full = compiled.report().unwrap().full.as_ref().unwrap();
        for resource in &full.resources {
            let allocation_id = resource.allocation.expect("retained transient allocation");
            let allocation = full.allocations.iter()
                .find(|allocation| allocation.id == allocation_id)
                .expect("allocation report");
            prop_assert_eq!(
                allocation.resource_ids.iter().filter(|id| **id == resource.id).count(),
                1
            );
        }

        for allocation in &full.allocations {
            let resources = allocation.resource_ids.iter().map(|id| {
                full.resources.iter().find(|resource| resource.id == *id).unwrap()
            }).collect::<Vec<_>>();
            let buckets = resources.iter().map(|resource| match &resource.descriptor {
                ResourceDescriptor::Buffer(desc) => desc.size.max(1).next_power_of_two(),
                ResourceDescriptor::Texture(_) => unreachable!(),
            }).collect::<Vec<_>>();
            prop_assert!(buckets.windows(2).all(|pair| pair[0] == pair[1]));
            let lifetimes_do_not_overlap = resources.windows(2).all(|pair| {
                pair[0].lifetime.unwrap().last_use < pair[1].lifetime.unwrap().first_use
            });
            prop_assert!(lifetimes_do_not_overlap);
        }
    }
}
