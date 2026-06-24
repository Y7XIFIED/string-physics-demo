# string-physics-demo

A real-time physics simulation where every character of a text string becomes an interconnected particle — responding to gravity, constraints, and your touch. Drag letters, watch them unravel, and feel the weight of words.

## 🚀 Live Demo

**[https://string-physics-demo.vercel.app](https://string-physics-demo.vercel.app)**

## ✨ Features

- Verlet integration physics engine running at a fixed 120 Hz timestep
- Zig-zag (snake) string-order layout for seamless line-to-line chaining
- Multitouch drag support — grab multiple letters simultaneously
- Collision response between non-adjacent unlocked letters
- Viewport boundary bouncing with configurable restitution
- Press **F** to toggle gravity and watch the full string unravel
- Responsive — shorter paragraph on narrow screens

## 🛠 Local Development

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:5173)
npm run dev

# Production build
npm run build
```

## 🧰 Tech Stack

- **Vite** — lightning-fast dev server & bundler
- **TypeScript** — typed physics logic
- **Nasalization OTF** — custom display font
- Vanilla DOM + Canvas API for layout measurement

---

Made by **Y7XIFIED**

![Preview Demo](preview.gif)
