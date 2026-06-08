import { AMADEUS_STAGE } from "@amadeus/core";

export function App() {
  return (
    <main className="app-shell">
      <h1>Amadeus</h1>
      <p>Stage: {AMADEUS_STAGE}</p>
    </main>
  );
}

