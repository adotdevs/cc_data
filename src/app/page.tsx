import { Suspense } from 'react';
import { getAuthSession } from '@/lib/auth';
import { MongoUserExplorer } from '@/components/MongoUserExplorer';
import { PinLockScreen } from '@/components/PinLockScreen';

async function AuthenticatedHome() {
  const session = await getAuthSession();

  if (!session.authenticated) {
    return <PinLockScreen />;
  }

  return <MongoUserExplorer />;
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-sm">
          Verifying session...
        </div>
      }
    >
      <AuthenticatedHome />
    </Suspense>
  );
}
