import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeftIcon } from "../components/Icons.jsx";
import { addTwoMonths } from "../lib/date.js";

const programs = [
  "Weight Loss",
  "Strength Training",
  "Small Groups",
  "Sports Specific Training",
  "Toning and Shaping"
];
const packageSizes = [1, 4, 8, 12, 16];

const fieldClass =
  "mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-emerald-700 sm:text-base";

export default function ClientFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    program: "",
    sessionType: "One-on-One",
    packageSize: "",
    purchaseDate: new Date().toISOString().slice(0, 10),
    paid: false
  });

  const expiryDate = useMemo(() => addTwoMonths(form.purchaseDate), [form.purchaseDate]);

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function submitForm(event) {
    event.preventDefault();
    navigate("/clients");
  }

  return (
    <section className="page-wrap space-y-4 sm:space-y-5">
      <header className="page-header flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeftIcon />
        </button>
        <h1 className="page-title text-2xl sm:text-3xl">{isEdit ? "Edit Client" : "Add New Client"}</h1>
      </header>

      <form className="space-y-4" onSubmit={submitForm}>
        <article className="surface-card">
          <h2 className="section-title">Basic Information</h2>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium sm:text-base">Name *</span>
              <input
                required
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                className={fieldClass}
                placeholder="Enter client name"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium sm:text-base">Phone Number *</span>
              <input
                required
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
                className={fieldClass}
                placeholder="+27 82 123 4567"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium sm:text-base">Email (Optional)</span>
              <input
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                className={fieldClass}
                placeholder="client@email.com"
              />
            </label>
          </div>
        </article>

        <article className="surface-card">
          <h2 className="section-title">Package Details</h2>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium sm:text-base">Program *</span>
              <select
                required
                value={form.program}
                onChange={(event) => updateField("program", event.target.value)}
                className={fieldClass}
              >
                <option value="">Select a program</option>
                {programs.map((program) => (
                  <option key={program} value={program}>
                    {program}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <p className="mb-2 text-sm font-medium sm:text-base">Session Type *</p>
              <div className="grid grid-cols-2 gap-3">
                {["One-on-One", "Group"].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => updateField("sessionType", type)}
                    className={`h-12 rounded-xl border text-sm font-semibold transition sm:text-base ${
                      form.sessionType === type
                        ? "border-emerald-700 bg-emerald-50 text-emerald-700"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-medium sm:text-base">Package Size *</span>
              <select
                required
                value={form.packageSize}
                onChange={(event) => updateField("packageSize", event.target.value)}
                className={fieldClass}
              >
                <option value="">Select package size</option>
                {packageSizes.map((size) => (
                  <option key={size} value={size}>
                    {size} Session{size > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium sm:text-base">Purchase Date *</span>
              <input
                required
                type="date"
                value={form.purchaseDate}
                onChange={(event) => updateField("purchaseDate", event.target.value)}
                className={fieldClass}
              />
            </label>

            <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50 p-3">
              <p className="text-sm text-slate-600">Package Expires</p>
              <p className="text-lg font-semibold text-amber-700 sm:text-xl">{expiryDate}</p>
              <p className="text-sm text-slate-500">2 months from purchase date</p>
            </div>
          </div>
        </article>

        <article className="surface-card">
          <h2 className="section-title">Payment Status</h2>
          <label className="flex items-center gap-3 text-sm sm:text-base">
            <input
              type="checkbox"
              checked={form.paid}
              onChange={(event) => updateField("paid", event.target.checked)}
              className="h-5 w-5 rounded border-slate-300"
            />
            Client has paid for this package
          </label>
        </article>

        <button type="submit" className="action-btn action-btn-primary w-full">
          Save Client
        </button>
      </form>
    </section>
  );
}
