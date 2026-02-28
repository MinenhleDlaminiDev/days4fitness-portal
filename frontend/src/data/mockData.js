export const clients = [
  {
    id: 1,
    name: "John Smith",
    phone: "+27 82 123 4567",
    email: "john.smith@email.com",
    program: "Weight Loss",
    sessionType: "One-on-One",
    sessionsTotal: 12,
    sessionsUsed: 5,
    paid: true,
    purchaseDate: "2024-09-15",
    expiryDate: "2026-04-14"
  },
  {
    id: 2,
    name: "Sarah Johnson",
    phone: "+27 82 555 1101",
    email: "sarah.j@email.com",
    program: "Strength Training",
    sessionType: "One-on-One",
    sessionsTotal: 8,
    sessionsUsed: 2,
    paid: false,
    purchaseDate: "2026-01-08",
    expiryDate: "2026-04-21"
  },
  {
    id: 3,
    name: "Mike Peters",
    phone: "+27 82 555 2202",
    email: "mike.p@email.com",
    program: "Small Groups",
    sessionType: "Group",
    sessionsTotal: 16,
    sessionsUsed: 10,
    paid: true,
    purchaseDate: "2026-01-20",
    expiryDate: "2026-03-22"
  },
  {
    id: 4,
    name: "Emma Davis",
    phone: "+27 82 555 3303",
    email: "emma.d@email.com",
    program: "Toning and Shaping",
    sessionType: "Group",
    sessionsTotal: 12,
    sessionsUsed: 3,
    paid: false,
    purchaseDate: "2026-01-10",
    expiryDate: "2026-04-03"
  },
  {
    id: 5,
    name: "Anna Wilson",
    phone: "+27 82 555 4404",
    email: "anna.w@email.com",
    program: "Weight Loss",
    sessionType: "One-on-One",
    sessionsTotal: 8,
    sessionsUsed: 5,
    paid: true,
    purchaseDate: "2026-01-01",
    expiryDate: "2026-03-05"
  }
];

export const todaySessions = [
  { id: 101, clientId: 1, time: "08:00", completed: false },
  { id: 102, clientId: 2, time: "09:30", completed: false },
  { id: 103, clientId: 3, time: "11:00", completed: false },
  { id: 104, clientId: 4, time: "14:00", completed: false }
];

export const scheduleEntries = [
  { client: "John Smith", program: "Weight Loss", day: 0, time: "05:00", paid: true },
  { client: "John Smith", program: "Weight Loss", day: 1, time: "05:00", paid: true },
  { client: "John Smith", program: "Weight Loss", day: 2, time: "05:00", paid: true },
  { client: "John Smith", program: "Weight Loss", day: 4, time: "05:00", paid: true },
  { client: "Sarah Johnson", program: "Strength Training", day: 0, time: "06:00", paid: false },
  { client: "David Lee", program: "Strength Training", day: 1, time: "06:00", paid: true },
  { client: "Sarah Johnson", program: "Strength Training", day: 2, time: "06:00", paid: false },
  { client: "David Lee", program: "Strength Training", day: 3, time: "06:00", paid: true },
  { client: "Mike Peters", program: "Small Groups", day: 0, time: "07:00", paid: true },
  { client: "Anna Wilson", program: "Small Groups", day: 3, time: "07:00", paid: true },
  { client: "Mike Peters", program: "Small Groups", day: 4, time: "07:00", paid: true },
  { client: "Emma Davis", program: "Toning and Shaping", day: 0, time: "08:00", paid: false },
  { client: "Emma Davis", program: "Toning and Shaping", day: 2, time: "08:00", paid: false },
  { client: "Lisa Brown", program: "Weight Loss", day: 4, time: "08:00", paid: true },
  { client: "Emma Davis", program: "Toning and Shaping", day: 5, time: "08:00", paid: false },
  { client: "Sarah Johnson", program: "Strength Training", day: 1, time: "09:00", paid: false },
  { client: "Rachel Green", program: "Toning and Shaping", day: 3, time: "09:00", paid: true },
  { client: "Chris Martin", program: "Weight Loss", day: 5, time: "09:00", paid: true },
  { client: "Mike Peters", program: "Small Groups", day: 2, time: "10:00", paid: true },
  { client: "David Lee", program: "Strength Training", day: 5, time: "10:00", paid: true },
  { client: "Mike Peters", program: "Small Groups", day: 1, time: "14:00", paid: true },
  { client: "Lisa Brown", program: "Weight Loss", day: 0, time: "16:00", paid: false },
  { client: "Lisa Brown", program: "Weight Loss", day: 2, time: "16:00", paid: false },
  { client: "Tom Wilson", program: "Sports Specific", day: 4, time: "16:00", paid: true },
  { client: "Tom Wilson", program: "Sports Specific", day: 0, time: "17:00", paid: true },
  { client: "Rachel Green", program: "Toning and Shaping", day: 1, time: "17:00", paid: true },
  { client: "Tom Wilson", program: "Sports Specific", day: 2, time: "17:00", paid: true },
  { client: "Emma Davis", program: "Toning and Shaping", day: 3, time: "17:00", paid: false },
  { client: "Anna Wilson", program: "Small Groups", day: 4, time: "17:00", paid: true },
  { client: "Anna Wilson", program: "Small Groups", day: 0, time: "18:00", paid: true },
  { client: "Chris Martin", program: "Weight Loss", day: 1, time: "18:00", paid: false },
  { client: "Chris Martin", program: "Weight Loss", day: 3, time: "18:00", paid: false },
  { client: "Rachel Green", program: "Toning and Shaping", day: 4, time: "18:00", paid: false }
];

export const profileSessionHistory = [
  { date: "2024-11-10", time: "08:00", completed: true },
  { date: "2024-11-08", time: "08:00", completed: true },
  { date: "2024-11-05", time: "09:30", completed: true },
  { date: "2024-11-01", time: "08:00", completed: true },
  { date: "2024-10-28", time: "11:00", completed: true }
];

