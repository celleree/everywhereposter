export const dynamic = 'force-dynamic';
import { ReactNode } from 'react';
import loadDynamic from 'next/dynamic';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
const ReturnUrlComponent = loadDynamic(() => import('./return.url.component'));
export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="bg-primary flex flex-1 justify-center p-[12px] gap-[12px] min-h-screen w-screen text-newTextColor">
      {/*<style>{`html, body {overflow-x: hidden;}`}</style>*/}
      <ReturnUrlComponent />
      <div className="flex flex-col py-[40px] px-[20px] flex-1 max-w-[600px] rounded-[12px] p-[12px] bg-newBgColorInner">
        <div className="w-full max-w-[440px] mx-auto justify-center gap-[20px] h-full flex flex-col">
          <LogoTextComponent />
          <div className="flex">{children}</div>
        </div>
      </div>

    </div>
  );
}
