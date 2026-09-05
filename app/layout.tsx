import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'QuickPrice · 快速计价助手',
  description: '支持多品类、批量型号匹配、数量和单价调整的快速计价助手。手机、电脑随时输入清单，轻松导出报价。',
  icons: { icon: '/favicon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f5f6f8' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
