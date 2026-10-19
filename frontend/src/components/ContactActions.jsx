import { Mail, MessageCircle, MessageSquare } from "lucide-react";

const ICONS = {
  whatsapp: MessageCircle,
  sms: MessageSquare,
  email: Mail
};

// Two looks for the same row of links: "card" sits on a surface card, "header"
// sits on the green page header. Nothing else differs.
const STYLES = {
  card: "border-line bg-surface text-accent hover:bg-raised",
  header: "border-white/20 bg-white/10 text-white hover:bg-white/20"
};

/**
 * A row of pre-filled contact links. Renders nothing when the client has no
 * phone number and no email, so a missing detail hides the action instead of
 * producing a link that opens on nothing.
 */
export default function ContactActions({ actions, clientName, variant = "card", className = "" }) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {actions.map((action) => {
        const Icon = ICONS[action.key];
        return (
          <a
            key={action.key}
            href={action.href}
            target="_blank"
            rel="noreferrer"
            // The card variant sits on top of a stretched link covering the
            // whole row, so it needs its own stacking context to stay tappable.
            className={`relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${STYLES[variant]}`}
            aria-label={`${action.label} ${clientName}`}
            title={`${action.label} ${clientName}`}
          >
            <Icon size={18} className="stroke-[1.75]" />
          </a>
        );
      })}
    </div>
  );
}
