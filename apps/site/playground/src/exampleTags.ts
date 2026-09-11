/** Stable catalog IDs and shared display names for classification and future filtering. */
export const exampleTagLabels = {
	"webgpu": "WebGPU",
	"typegpu": "TypeGPU",
	"threejs": "Three.js",
	"babylonjs": "Babylon.js",
	"babylon-lite": "Babylon Lite",
	"render": "Render",
	"compute": "Compute",
	"gpu-culling": "GPU Culling",
	"indirect-draw": "Indirect Draw",
	"interop": "Interop",
	"shared-resources": "Shared Resources",
	"simulation": "Simulation",
	"inference": "Inference",
	"lighting": "Lighting",
	"fluid-simulation": "Fluid Simulation",
	"rigid-body": "Rigid Bodies",
	"transient-resources": "Transient Resources",
	"presentation": "Presentation",
	"imported-resources": "Imported Resources",
	"uniform-buffer": "Uniform Buffer",
	"persistent-resources": "Persistent Resources",
	"external-submission": "External Submission",
	"snapshot": "Snapshot",
	"diagnostics": "Diagnostics",
	"gpu-timing": "GPU Timing",
	"storage-buffer": "Storage Buffer"
} as const;

export type ExampleTag = keyof typeof exampleTagLabels;
