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
    <section>
      <header className="flex items-center gap-3 bg-[#2f66e0] px-5 py-5 text-white">
        <button type="button" onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeftIcon />
        </button>
        <h1 className="text-[40px] font-semibold">{isEdit ? "Edit Client" : "Add New Client"}</h1>
      </header>

      <form className="space-y-4 px-4 py-5" onSubmit={submitForm}>
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-[38px] font-semibold">Basic Information</h2>
          <div className="space-y-3">
            <label className="block">
              <span className="text-[31px] font-medium">Name *</span>
              <input
                required
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                className="mt-2 h-14 w-full rounded-xl border border-slate-300 px-4 text-[31px] outline-none focus:border-[#2f66e0]"
                placeholder="Enter client name"
              />
            </label>
            <label className="block">
              <span className="text-[31px] font-medium">Phone Number *</span>
              <input
                required
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
                className="mt-2 h-14 w-full rounded-xl border border-slate-300 px-4 text-[31px] outline-none focus:border-[#2f66e0]"
                placeholder="+27 82 123 4567"
              />
            </label>
            <label className="block">
              <span className="text-[31px] font-medium">Email (Optional)</span>
              <input
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                className="mt-2 h-14 w-full rounded-xl border border-slate-300 px-4 text-[31px] outline-none focus:border-[#2f66e0]"
                placeholder="client@email.com"
              />
            </label>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-[38px] font-semibold">Package Details</h2>
          <div className="space-y-3">
            <label className="block">
              <span className="text-[31px] font-medium">Program *</span>
              <select
                required
                value={form.program}
                onChange={(event) => updateField("program", event.target.value)}
                className="mt-2 h-14 w-full rounded-xl border border-slate-300 px-4 text-[31px] outline-none focus:border-[#2f66e0]"
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
              <p className="mb-2 text-[31px] font-medium">Session Type *</p>
              <div className="grid grid-cols-2 gap-3">
                {["One-on-One", "Group"].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => updateField("sessionType", type)}
                    className={`h-14 rounded-xl border text-[34px] font-semibold ${
                      form.sessionType === type
                        ? "border-[#2f66e0] bg-blue-50 text-[#2f66e0]"
                        : "border-slate-300 text-slate-700"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-[31px] font-medium">Package Size *</span>
              <select
                required
                value={form.packageSize}
                onChange={(event) => updateField("packageSize", event.target.value)}
                className="mt-2 h-14 w-full rounded-xl border border-slate-300 px-4 text-[31px] outline-none focus:border-[#2f66e0]"
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
              <span className="text-[31px] font-medium">Purchase Date *</span>
              <input
                required
                type="date"
                value={form.purchaseDate}
                onChange={(event) => updateField("purchaseDate", event.target.value)}
                className="mt-2 h-14 w-full rounded-xl border border-slate-300 px-4 text-[31px] outline-none focus:border-[#2f66e0]"
              />
            </label>

            <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3">
              <p className="text-[29px] text-slate-600">Package Expires</p>
              <p className="text-[35px] font-semibold text-amber-700">{expiryDate}</p>
              <p className="text-[28px] text-slate-500">2 months from purchase date</p>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-[38px] font-semibold">Payment Status</h2>
          <label className="flex items-center gap-3 text-[32px]">
            <input
              type="checkbox"
              checked={form.paid}
              onChange={(event) => updateField("paid", event.target.checked)}
              className="h-7 w-7 rounded border-slate-300"
            />
            Client has paid for this package
          </label>
        </article>

        <button
          type="submit"
          className="h-14 w-full rounded-xl bg-[#2f66e0] text-[35px] font-semibold text-white"
        >
          Save Client
        </button>
      </form>
    </section>
  );
}
