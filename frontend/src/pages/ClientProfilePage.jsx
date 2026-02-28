import { useParams } from "react-router-dom";

export default function ClientProfilePage() {
  const { id } = useParams();

  return (
    <section>
      <h1 className="text-2xl font-semibold">Client Profile</h1>
      <p className="mt-2 text-slate-600">Viewing client ID: {id}</p>
    </section>
  );
}

