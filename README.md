## Быстрый старт

Запустите Google Chrome следующим образом:

```bash
google-chrome --enable-unsafe-webgpu --ozone-platform=x11 --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan
```

Затем запустите проект:

```bash
npm install
npm run dev   # запускает Vite dev-сервер с горячей перезагрузкой
```