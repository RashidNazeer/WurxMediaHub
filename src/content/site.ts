/**
 * ============================================================================
 * MARKETING COPY AND NUMBERS, the only file to edit for landing page content.
 * ============================================================================
 * Everything a non-developer would want to change lives here: the headline
 * stats, the brand list, the three steps. No component hardcodes this text.
 */

/* ---------------------------------------------------------------- stats --- */

/**
 * Headline numbers. Confirmed by Rashid on 2026-07-29, and re-checked against
 * wurxmedia.com on 2026-09-22 at his request ("read everything and update if
 * something needs to be updated"): the official site says 1,000 creators, not
 * 5K+, and a TikTok reviewer reads both sites. The other two already matched.
 */
export const STATS = [
  { value: '100M+', label: 'Est. revenue generated' },
  { value: '1,000+', label: 'Creators' },
  { value: '2B+', label: 'Views generated' },
] as const;

/* --------------------------------------------------------------- brands --- */

import bentgo from '@/assets/brands/bentgo.png';
import bioschwartz from '@/assets/brands/bioshwartz.png';
import brumate from '@/assets/brands/brumate.png';
import cutler from '@/assets/brands/cutler.png';
import m3 from '@/assets/brands/m3.png';
import physiciansChoice from '@/assets/brands/physicians-choice.png';
import pureDailyCare from '@/assets/brands/puredailycare.png';
import vitauthority from '@/assets/brands/vitauthority.png';

interface BrandLogo {
  name: string;
  logo: string;
  /** Rendered height in px. Square marks need less than wide wordmarks. */
  h?: number;
}

/**
 * Partner logos, taken from the marquee on wurxmedia.com.
 *
 * The originals were PNGs wrapped in SVG (315 KB total, one of them a
 * 2048x2048 bitmap for a 38px slot). They were unwrapped and downscaled to
 * 37 KB total. All are white artwork on an OPAQUE BLACK background, which is
 * why the marquee blends rather than just drawing them - see `--wx-logo-blend`.
 *
 * To add a brand: drop the file in src/assets/brands/, import it, add a row.
 */
/**
 * Heights are tuned per logo so each one carries roughly the same optical
 * weight. A wide wordmark needs less height than a stacked or square mark, or
 * it dominates the row.
 */
export const BRANDS: BrandLogo[] = [
  { name: "Physician's Choice", logo: physiciansChoice, h: 22 },
  { name: 'Pure Daily Care', logo: pureDailyCare, h: 44 },
  { name: 'BruMate', logo: brumate, h: 30 },
  { name: 'Cutler', logo: cutler, h: 24 },
  { name: 'Bentgo', logo: bentgo, h: 34 },
  { name: 'M3 Naturals', logo: m3, h: 44 },
  { name: 'BioSchwartz', logo: bioschwartz, h: 34 },
  { name: 'Vitauthority', logo: vitauthority, h: 24 },
];

/* ----------------------------------------------------------- how it works -- */

export const STEPS = [
  {
    n: '01',
    title: 'Apply',
    body: 'Tell us your handles, your niche and your best videos. Every application is read by a human. We keep the roster intentional, so this is not a sign-up button.',
  },
  {
    n: '02',
    title: 'Get matched',
    body: 'Approved creators are assigned a tier and let into the Brand Hubs that fit them. Samples, briefs and commission rates are waiting inside.',
  },
  {
    n: '03',
    title: 'Post and track',
    body: 'Film, post, and watch your real GMV land in your dashboard. Same numbers we see. No screenshots, no waiting on a reply.',
  },
] as const;

/* -------------------------------------------------------------- features -- */

export const FEATURES = [
  {
    icon: 'chart' as const,
    title: 'My Numbers',
    body: 'GMV, orders, commission earned and the ad spend sitting behind your own videos, per brand, updated daily, with the timestamp shown.',
  },
  {
    icon: 'trophy' as const,
    title: 'Live leaderboards',
    body: 'See exactly where you rank inside every brand hub. Totals only, and you can opt out whenever you want.',
  },
  {
    icon: 'target' as const,
    title: 'Contests and sprints',
    body: 'Tiered GMV sprints with real progress bars. Hit $1K, earn the bonus. No guessing how close you are.',
  },
  {
    icon: 'wallet' as const,
    title: 'Retainers and offers',
    body: 'Boosted commission tiers, pay-per-video slots and retainer openings, unlocked as your tier goes up.',
  },
  {
    icon: 'file' as const,
    title: 'Briefs that make sense',
    body: 'Hooks, angles, do and do-not lists, deadlines and sample requests. Everything a brand expects, in one place.',
  },
  {
    icon: 'users' as const,
    title: 'One login, every brand',
    body: 'Every brand you work with in a single hub, each themed as itself. Stop juggling group chats and spreadsheets.',
  },
] as const;
