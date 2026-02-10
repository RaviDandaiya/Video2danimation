/**
 * High-Fidelity Anime/Manga Processor
 * Modes:
 * 1. Lo-Fi Animation (Ultra Clean, flat colors, stabilized)
 * 2. Storyboard Sketch (Detailed ink with controlled "boiling" flicker)
 */

let prevDoG = null;
let prevColors = null;

self.onmessage = function (e) {
    const { imageData, width, height, mode, reset } = e.data;

    if (reset) {
        prevDoG = null;
        prevColors = null;
        return;
    }

    const data = imageData.data;
    const len = width * height;

    // Initialize state
    if (!prevDoG || prevDoG.length !== len) {
        prevDoG = new Float32Array(len);
        prevColors = new Float32Array(data.length);
    }

    // Helper: Gaussian Blur Approximation (3-pass Box Blur)
    const boxBlur = (src, dest, w, h, radius) => {
        // Horizontal pass
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0;
                let count = 0;
                for (let k = -radius; k <= radius; k++) {
                    const px = x + k;
                    if (px >= 0 && px < w) {
                        sum += src[y * w + px];
                        count++;
                    }
                }
                dest[y * w + x] = sum / count;
            }
        }
        // Vertical pass (write back to same buffer safely)
        const temp = new Float32Array(dest);
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                let sum = 0;
                let count = 0;
                for (let k = -radius; k <= radius; k++) {
                    const py = y + k;
                    if (py >= 0 && py < h) {
                        sum += temp[py * w + x];
                        count++;
                    }
                }
                dest[y * w + x] = sum / count;
            }
        }
    };

    const blur = (src, w, h, radius) => {
        const pass1 = new Float32Array(src.length);
        const pass2 = new Float32Array(src.length);
        boxBlur(src, pass1, w, h, radius);
        boxBlur(pass1, pass2, w, h, radius);
        boxBlur(pass2, pass1, w, h, radius);
        return pass1;
    };

    // 1. Grayscale extraction
    const grayscale = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        grayscale[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
    }

    // 2. Difference of Gaussians (DoG) Edge Detection
    const blur1 = blur(grayscale, width, height, 1); // Fine details
    const blur2 = blur(grayscale, width, height, 4); // Broad structure

    const dogEdges = new Float32Array(len);
    // Sensitivity: Animation needs sharp clean lines, Sketch needs more details
    const sensitivity = mode === 'sketch' ? 12.0 : 25.0;

    // Threshold Boiling: Only for sketch
    const baseThresh = 2.0;
    const jitter = mode === 'sketch' ? (Math.random() - 0.5) * 1.2 : 0.0;

    for (let i = 0; i < len; i++) {
        const diff = (blur1[i] - blur2[i]);
        // Sigmoid thresholding
        const val = 1.0 - (1.0 / (1.0 + Math.exp(-sensitivity * (Math.abs(diff) - (baseThresh + jitter)))));
        dogEdges[i] = val;
    }

    // 3. Temporal Processing (The key to "Clean" vs "Blinking")
    // Animation: High alpha (0.9) = Very stable.
    // Sketch: Low alpha (0.2) = Active boiling.
    const edgeAlpha = mode === 'sketch' ? 0.2 : 0.9;

    for (let i = 0; i < len; i++) {
        prevDoG[i] = prevDoG[i] * edgeAlpha + dogEdges[i] * (1 - edgeAlpha);
        // Snap to sharp black/white
        dogEdges[i] = prevDoG[i] < 0.5 ? 0.0 : 1.0;
    }

    // 4. Output Generation
    if (mode === 'sketch') {
        // STORYBOARD SKETCH: High Contrast Ink
        for (let i = 0; i < len; i++) {
            const val = dogEdges[i] * 255;
            data[i * 4] = val;
            data[i * 4 + 1] = val;
            data[i * 4 + 2] = val;
            data[i * 4 + 3] = 255;
        }
    } else {
        // LO-FI ANIMATION: Clean Flat Colors
        const levels = 16; // Smoother transitions, less z-fighting
        const colorAlpha = 0.85; // Ultra stable colors

        for (let i = 0; i < len; i++) {
            const idx = i * 4;
            let r = data[idx];
            let g = data[idx + 1];
            let b = data[idx + 2];

            // Posterize
            r = Math.round(r / (255 / levels)) * (255 / levels);
            g = Math.round(g / (255 / levels)) * (255 / levels);
            b = Math.round(b / (255 / levels)) * (255 / levels);

            // Enhance vibrancy for "Chill Lo-Fi" look
            const avg = (r + g + b) / 3;
            r = avg + (r - avg) * 1.3;
            g = avg + (g - avg) * 1.3;
            b = avg + (b - avg) * 1.3;

            // Stabilize colors over time
            if (prevColors[idx] !== undefined) {
                r = prevColors[idx] * colorAlpha + r * (1 - colorAlpha);
                g = prevColors[idx + 1] * colorAlpha + g * (1 - colorAlpha);
                b = prevColors[idx + 2] * colorAlpha + b * (1 - colorAlpha);
            }
            prevColors[idx] = r;
            prevColors[idx + 1] = g;
            prevColors[idx + 2] = b;

            // Composite with stable lines
            const edge = dogEdges[i];
            data[idx] = r * edge;
            data[idx + 1] = g * edge;
            data[idx + 2] = b * edge;
        }
    }

    self.postMessage({ imageData }, [imageData.data.buffer]);
};
