# UI brief, the creator experience

> **Archived 2026-10-30.** Finished or superseded work, kept for history. It describes the code and decisions as they were when it was written, so file names in it may be gone. For where things stand now read `docs/PROJECT_STATE.md`; the docs index is `docs/README.md`.

**Paste everything below the line into the UI agent.**

Deliberately short. An earlier version of this file described our current
screens section by section, with the copy and the colours, and the agent handed
back what we already had. It only has room to design if we tell it the product
and the data and then stop talking.

---

# Design the creator experience for WurxMediaHub

## What it is

A private platform for TikTok Shop creators who work with brands. A creator
applies, gets approved by the team, and then works: they browse the brands open
to them, take offers, and get paid. The platform tracks every job from the
moment they are accepted onto it to the moment the money lands.

**Transparency is the product.** Creators are used to being kept in the dark
about what a job pays and where their payment is. Here they can see all of it,
whenever they want, without asking anybody.

Most of them are on a phone.

## What to design

Five screens, for a creator who has already been approved.

| Screen        | The only question it has to answer                                                 |
| ------------- | ---------------------------------------------------------------------------------- |
| **Home**      | Have I been paid, what is still coming, and what is happening with the work I took |
| **Offers**    | What can I take right now                                                          |
| **Brands**    | Who can I work with                                                                |
| **One brand** | What do they sell, what do they pay me on each product, and what are they offering |
| **Profile**   | My account details                                                                 |

Plus a small dialog for applying to an offer.

You have a completely free hand on layout, structure, navigation, colour,
typography and motion. Nothing about the current product is worth preserving.
If a screen works better as something other than cards in a grid, do that. We
are going to charge for this, so it needs to feel like it: modern, confident,
animated, and better looking than the tools these creators already use.

Give us something with a point of view. If you want to show two different
directions for the home screen, do.

## The work pipeline

Once a creator is accepted onto an offer, the job moves through seven stages.
Both the creator and the team use these exact words, so a phone call between
them means one thing. Do not rename or reorder them.

1. Pending request, we are getting it set up
2. Sample requested, from the brand
3. Sample shipped, on its way to them
4. Content pending, over to the creator to film
5. Content completed, filmed and being checked
6. Payment pending, approved for payment
7. Paid

Money follows the stage: stages 1 to 5 are **in progress**, stage 6 is
**awaiting payment**, stage 7 is **paid**. Those three always add up to the
total the creator has been promised.

Stages change while the creator is looking at the screen, with no refresh. That
is the platform's proudest behaviour and it currently goes unnoticed.

## Build it with

React + TypeScript, Tailwind CSS v4, Motion (`motion/react`), lucide-react.
Nothing else, and no chart library, so any chart is hand-built. Static mock data
in the shape below, no data fetching. Dark and light both matter. It has to work
from 375px up to a wide desktop with no sideways scrolling.

## Four things that are not up for grabs

- **Only the data below exists.** There are no view counts, no follower numbers,
  no GMV and no sales figures in this product yet, so do not design charts that
  need them.
- **Creators must never see what a brand pays us, or who the client is.** That
  data is not below, and it must not appear.
- Every image can be missing. Every price and every fee can be missing. Nothing
  should print a zero in place of a number nobody has set yet.
- No em dashes or en dashes in any copy.

## The data

All amounts USD. The money is consistent: paid 460 + awaiting payment 240 +
in progress 2300 = 3000 agreed in total.

```ts
export const creator = {
  displayName: 'Maya Ellison',
  email: 'maya@example.com',
  tiktokHandle: 'mayaonmain',
  tier: 'Rising', // Creator, Rising, Pro, Elite
  joined: '2026-03-14',
  niche: 'Beauty & skincare',
};

export const summary = {
  offersImOn: 5,
  brandsIWorkWith: 3,
  waitingOnADecision: 1,
  notAccepted: 1,
  money: { paid: 460, awaitingPayment: 240, inProgress: 2300, total: 3000 },
  // how many jobs sit at each stage right now, and how much money is parked there
  byStage: {
    pending_request: { count: 0, amount: 0 },
    sample_requested: { count: 0, amount: 0 },
    sample_shipped: { count: 1, amount: 900 },
    content_pending: { count: 1, amount: 1400 },
    content_completed: { count: 0, amount: 0 },
    payment_pending: { count: 1, amount: 240 },
    paid: { count: 2, amount: 460 },
  },
};

export const brands = [
  {
    id: 'b1',
    name: 'Vitauthority',
    tagline: 'Wellness & Weight Support',
    description:
      'Clean, science-backed supplements with a loyal repeat customer base. Creators do best here with honest before-and-after storytelling rather than hard selling.',
    logo: null,
    offerCount: 3,
  },
  {
    id: 'b2',
    name: 'BruMate',
    tagline: 'Drinkware That Keeps Up',
    description:
      'Insulated drinkware with a strong outdoor and tailgate audience. Product in use beats product on a shelf every single time.',
    logo: null,
    offerCount: 4,
  },
  {
    id: 'b3',
    name: 'Physicians Choice',
    tagline: 'Gut Health, Backed by Research',
    description:
      'Probiotics and digestive health, sold on evidence. Claims are checked before anything goes live, so scripts are approved in advance here.',
    logo: null,
    offerCount: 1,
  },
  {
    id: 'b4',
    name: 'Bentgo',
    tagline: 'Lunch, Sorted',
    description:
      'Leakproof lunchboxes with a huge back-to-school season. Parents buy on convenience, kids buy on colour.',
    logo: null,
    offerCount: 2,
  },
];

// What each brand sells. `commission` is the percentage the creator earns on a
// sale, and it is the number they came to this screen for.
export const products = {
  b1: [
    { name: 'Multi Collagen Burn, 30 servings', price: 49.99, commission: 25, badge: 'HERO' },
    { name: 'Lean Bliss Greens, 30 servings', price: 39.99, commission: 22, badge: null },
    { name: 'Daily Multivitamin, 60 count', price: 24.99, commission: 20, badge: null },
  ],
  b2: [
    { name: 'Hopsulator Trio, 16 oz', price: 29.99, commission: 18, badge: 'HERO' },
    { name: 'Era Tumbler, 25 oz', price: 34.99, commission: 18, badge: null },
  ],
  b3: [
    { name: 'Probiotic 60 Billion CFU, 30 count', price: 27.95, commission: 24, badge: 'HERO' },
    { name: 'Prebiotic Fiber, 30 servings', price: 21.95, commission: 20, badge: null },
    { name: 'Digestive Enzymes, 60 count', price: null, commission: null, badge: null },
  ],
  b4: [], // this brand has listed nothing yet
};

// state:
//   'in'       accepted, work is under way, see `stage`
//   'waiting'  asked for it, no decision yet
//   'declined' the team said no, they can ask again
//   'open'     no application needed, it is already theirs
//   'canApply' never asked
export const offers = [
  {
    id: 'o1',
    brandId: 'b1',
    badge: 'TOP PICK',
    title: 'Starter bundle',
    description:
      'Five in-feed videos featuring the hero product, posted within 30 days. Hook in the first two seconds.',
    videos: 5,
    pays: 300,
    state: 'in',
    stage: 'paid',
  },
  {
    id: 'o2',
    brandId: 'b1',
    badge: 'QUICK START',
    title: 'Single video test',
    description: 'One video, no commitment. A good way to see if we fit.',
    videos: 1,
    pays: 75,
    state: 'open',
  },
  {
    id: 'o3',
    brandId: 'b1',
    badge: null,
    title: 'Volume deal',
    description: 'Twenty videos across the quarter, paid monthly.',
    videos: 20,
    pays: 1400,
    state: 'in',
    stage: 'content_pending',
  },
  {
    id: 'o4',
    brandId: 'b2',
    badge: 'SEASONAL',
    title: 'Summer drinkware push',
    description: 'Three videos with the tumbler range, outdoors, before the end of August.',
    videos: 3,
    pays: 240,
    state: 'in',
    stage: 'payment_pending',
  },
  {
    id: 'o5',
    brandId: 'b2',
    badge: null,
    title: 'Unboxing only',
    description: 'One unboxing video. Open to anyone on the roster.',
    videos: 1,
    pays: 60,
    state: 'open',
  },
  {
    id: 'o6',
    brandId: 'b2',
    badge: null,
    title: 'Autumn restock',
    description: 'Two videos for the autumn colourways.',
    videos: 2,
    pays: 160,
    state: 'in',
    stage: 'paid',
  },
  {
    id: 'o7',
    brandId: 'b2',
    badge: null,
    title: 'Holiday gifting hero',
    description: 'Six videos through November, gifting angle.',
    videos: 6,
    pays: 520,
    state: 'declined',
    teamNote: 'We have filled this one for now. Come back for the winter push.',
  },
  {
    id: 'o8',
    brandId: 'b3',
    badge: 'HIGHEST PAYING',
    title: 'Gut health series',
    description: 'Ten videos telling one story across the month. Script approval required.',
    videos: 10,
    pays: 900,
    state: 'in',
    stage: 'sample_shipped',
  },
  {
    id: 'o9',
    brandId: 'b4',
    badge: null,
    title: 'Back to school lunchbox push',
    description: 'Four videos before the end of August, parent-facing.',
    videos: 4,
    pays: 320,
    state: 'waiting',
  },
  {
    id: 'o10',
    brandId: 'b4',
    badge: 'BOOSTED',
    title: 'Lunchbox commission boost',
    description: 'Raised commission on the whole range for the season.',
    videos: null,
    pays: null,
    state: 'canApply',
  }, // no set deliverable, no set fee
];

// The creator's own history, newest first. This is what "something happened"
// looks like to them.
export const activity = [
  { offerId: 'o4', stage: 'payment_pending', note: null, at: '2026-08-08' },
  { offerId: 'o4', stage: 'content_completed', note: null, at: '2026-08-06' },
  {
    offerId: 'o8',
    stage: 'sample_shipped',
    note: 'Tracking sent to your email.',
    at: '2026-08-04',
  },
  { offerId: 'o3', stage: 'content_pending', note: null, at: '2026-08-02' },
  { offerId: 'o6', stage: 'paid', note: null, at: '2026-07-29' },
  { offerId: 'o8', stage: 'sample_requested', note: null, at: '2026-07-24' },
  { offerId: 'o3', stage: 'pending_request', note: null, at: '2026-07-19' },
  { offerId: 'o1', stage: 'paid', note: null, at: '2026-06-12' },
];
```

## Also show us

- A creator who has just been approved and has taken nothing yet, so every
  screen is empty. This is a real creator's first five minutes and it should be
  the opposite of a dead page.
- What loading looks like.
- Both themes, and a phone width.

## Order

Home screen first, on its own, so we can react to the direction before you build
the rest.
