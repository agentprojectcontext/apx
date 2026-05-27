import { Route, Routes, useNavigate } from "react-router-dom";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { ApxAdminScreen } from "./screens/ApxAdminScreen";
import { ProjectScreen } from "./screens/ProjectScreen";
import { useTokenBootstrap } from "./hooks/useTokenBootstrap";

export function App() {
  const navigate = useNavigate();
  const auth = useTokenBootstrap();

  if (auth.status === "loading") {
    return <Splash text="Conectando con el daemon…" />;
  }
  if (auth.status === "error") {
    return (
      <Splash
        text="No pude llegar al daemon en localhost:7430."
        sub="Arrancá APX con `apx daemon start` y refrescá."
      />
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <ProjectSidebar onSelect={(href) => navigate(href)} />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<ApxAdminScreen />} />
          <Route path="/p/:pid/*" element={<ProjectScreen />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

function Splash({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="grid h-screen w-screen place-items-center">
      <div className="text-center">
        <div className="font-mono text-xs text-muted-fg whitespace-pre leading-none mb-4">
          {"  ▄███████▄\n █ ██   ██ █\n █  ◔   ◔  █\n █   ╰~╯   █\n  ▀███████▀"}
        </div>
        <div className="text-foreground">{text}</div>
        {sub && <div className="mt-2 text-sm text-muted-fg">{sub}</div>}
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="p-8">
      <h1 className="text-2xl">404</h1>
      <p className="text-muted-fg">Esa ruta no existe.</p>
    </div>
  );
}
