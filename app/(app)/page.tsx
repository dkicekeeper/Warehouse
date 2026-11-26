import { Overview } from '@/components/overview';

// A static shell with no data in it: everything on screen is fetched by the browser from /api/board,
// which answers only to the signed-in owner.
export default function Home() {
  return <Overview />;
}
