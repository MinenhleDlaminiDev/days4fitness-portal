import { useParams } from "react-router-dom";

export default function ClientFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);

  return (
    <section>
      <h1 className="text-2xl font-semibold">{isEdit ? "Edit Client" : "Add Client"}</h1>
      <p className="mt-2 text-slate-600">
        Client form fields and package assignment flow will be added here.
      </p>
    </section>
  );
}

