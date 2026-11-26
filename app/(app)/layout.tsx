import { BoardProvider } from '@/components/board-data';
import { Shell } from '@/components/shell';

// Every signed-in page shares one frame and one copy of the board, fetched by the browser from
// /api/board after sign-in: the pages themselves carry no data.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <BoardProvider>
      <Shell>{children}</Shell>
    </BoardProvider>
  );
}
