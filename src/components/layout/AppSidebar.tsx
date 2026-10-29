import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronLeft, ChevronRight, LogOut, Plus, X } from 'lucide-react';
import { PrismMark } from '@/components/brand/PrismMark';
import { prefetchRoute } from '@/app/router';
import { openAccountMenu } from '@/lib/account-menu';
import { cn } from '@/lib/utils';
import { isNavItemActive, navForRole, type NavItem } from '@/lib/nav';
import { useWurxbaseIdentity } from '@/lib/useWurxbaseIdentity';
import type { AppRole } from '@/lib/auth/auth-context';

/**
 * The product's navigation.
 *
 * REBUILT 2026-08-15 against the design Rashid supplied in `design/references/all-contest`,
 * because the old one was, in his words, very boring. What came across from that
 * design: the 280px rail, the brand block with a subtitle under the wordmark,
 * the gradient call to action at the top, roomier rows with the icon and label
 * on one line, and an active row drawn as a tinted pill WITH a solid bar on its
 * inner edge rather than a tint alone.
 *
 * WHAT DID NOT COME ACROSS IS THE PALETTE, and that was his call: the design is
 * indigo and violet on navy, and the Wurx palette was gold on near-black, locked to
 * wurxmedia.com in CLAUDE.md. So every surface, gradient and glow here is a
 * `--wx-*` token and the design's structure is what was copied.
 *
 * BOTH THEMES, as he asked. The glass utilities invert their wash in light mode
 * rather than tinting the dark one, because a white wash over paper is nothing
 * at all. See `tokens.css`.
 *
 * One component for the fixed desktop rail and the mobile drawer, so the two can
 * never drift apart. `collapsed` shrinks it to icons only on wide screens; the
 * drawer is never collapsed, because a drawer you have opened on purpose should
 * show you words.
 */

/**
 * The gradient button at the top of the rail.
 *
 * STAFF NO LONGER HAVE ONE, at Rashid's request on 2026-08-15: creating a
 * contest belongs on the contests screen, at the top right, beside the thing it
 * creates. A global button in the menu that navigates somewhere else first was
 * a worse version of the same idea, and it also collided with the real "New
 * contest" button on the brand's Contests tab.
 *
 * A CREATOR KEEPS THEIRS, because "Add a video" genuinely is one tap from
 * anywhere and is the thing they do most. The roles that create nothing get no
 * button rather than one that apologises when pressed.
 */
function createActionFor(role: AppRole | undefined): { label: string; to: string } | null {
  if (role === 'creator') return { label: 'Add a video', to: '/app/content' };
  return null;
}

/**
 * Where the menu was scrolled to, kept outside React. See the layout effect in
 * `AppSidebar` for why this is not state.
 */
let navScrollTop = 0;

export function AppSidebar({
  role,
  name,
  email,
  signingOut,
  onSignOut,
  onNavigate,
  onClose,
  onToggleCollapse,
  collapsed = false,
  accountMenu = false,
}: {
  role: AppRole | undefined;
  name: string | null;
  email: string | undefined;
  signingOut: boolean;
  onSignOut: () => void;
  onNavigate?: () => void;
  /** Present only in the mobile drawer. Adds a close button. */
  onClose?: () => void;
  /** Present only on the desktop rail. Makes the mark collapse the rail. */
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  /**
   * Creators and applicants only. Turns the user chip into the button that opens
   * the account menu. Left false for staff, whose chip is exactly as it was.
   */
  accountMenu?: boolean;
}) {
  const { pathname } = useLocation();
  /* Paid Collabs rows are drawn from the person's OWN WurxBase permissions
     where their row can be found, and from our role mapping where it cannot.
     A menu row must not offer a screen that bounces. */
  const { tabs: collabTabs } = useWurxbaseIdentity();
  const groups = navForRole(role, collabTabs);
  const initial = (name || email || '?').trim().charAt(0) || '?';
  const create = createActionFor(role);
  const navRef = useRef<HTMLElement>(null);

  /*
   * THE MENU MUST NOT JUMP BACK TO THE TOP WHEN YOU CLICK SOMETHING IN IT.
   *
   * Rashid, 2026-08-16: scroll down, click the last item, and the menu snaps to
   * the top. It happens because the list is a scroll container whose contents
   * are replaced on navigation, and a browser CLAMPS a container's scrollTop the
   * instant its content is briefly shorter than the current offset. Nothing in
   * our code scrolls it; the position is simply lost and never restored.
   *
   * So keep it ourselves. The value is module scope rather than state, on
   * purpose: writing it to state would re-render the rail on every wheel event,
   * and it must survive the rail being swapped between drawer and rail as well.
   * `useLayoutEffect` puts it back before the browser paints, so there is no
   * visible jump even when a restore is needed.
   */
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el) return;
    if (navScrollTop > 0 && el.scrollTop !== navScrollTop) {
      el.scrollTop = navScrollTop;
    }
    const remember = () => {
      navScrollTop = el.scrollTop;
    };
    el.addEventListener('scroll', remember, { passive: true });
    return () => el.removeEventListener('scroll', remember);
  });

  /*
   * THE ROOT PAINTS NOTHING, AND THAT IS DELIBERATE.
   *
   * It used to be `bg-bg`, which is what made the rail a flush panel welded to
   * the page edge. Rashid, 2026-10-08: the sidebar should read as "a card
   * placed on the background on the left side of the page".
   *
   * So the ground now belongs to whoever mounts this. The desktop rail wraps it
   * in a floating neomorphic card; the mobile drawer gives it a solid `bg-bg`,
   * because unlike the rail it slides over live content and has to be opaque.
   * One component, two grounds.
   */
  return (
    <div className="flex h-full flex-col bg-transparent">
      {/* ---------------------------------------------------------- brand -- */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-3',
          /* Collapsed, the mark and the toggle stack, so the toggle is still on
             screen and still obviously a button. It used to centre the mark
             alone, which is how the rail became a one-way door. */
          collapsed ? 'flex-col justify-center gap-3 px-2 py-4' : 'justify-between px-4 py-4'
        )}
      >
        {/*
          THE MARK IS THE COLLAPSE CONTROL ON DESKTOP, at Rashid's request on
          2026-08-16: "clicking on icon in menu bar should do the same job", so
          the arrow could come out of the top bar and give that space to the
          section name.

          It is a real `<button>` when it collapses and a real `<Link>` when it
          navigates, never one pretending to be the other, so the keyboard and a
          screen reader are told the truth about what it does. In the drawer it
          stays a link home, because a drawer has no collapsed state to toggle.
        */}
        <Link
          to="/"
          aria-label="Prism home"
          onClick={onNavigate}
          className={cn('flex items-center gap-3', collapsed && 'justify-center')}
        >
          <PrismMark markOnly={collapsed} height={collapsed ? 26 : 24} />
          {!collapsed ? (
            <span className="text-faint -mt-0.5 hidden text-[0.6875rem] leading-none font-medium sm:block">
              Creator Platform
            </span>
          ) : null}
        </Link>

        {/*
          A REAL, VISIBLE COLLAPSE BUTTON. Rashid, 2026-10-09: "on clicking
          Creator platform the bar collapses and there is no way to bring it
          back there should be a collapse and expand button."

          The mark itself used to be the toggle — his own earlier request, so
          the arrow could leave the top bar and give that space to the section
          name. The trouble is that a logo does not look like a control. It was
          labelled correctly for a screen reader, but with nothing on screen
          saying it could be pressed, collapsing the rail was a one-way door for
          anyone using their eyes.

          So the mark goes back to being a link home, which is what a logo
          means, and the collapsing is its own button with a chevron that points
          the way it will move. It stays visible when collapsed, which is the
          whole point.
        */}
        {onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
            className="wx-neo-raised-sm wx-neo-press text-muted hover:text-accent ease-brand grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-200"
          >
            {collapsed ? (
              <ChevronRight size={15} aria-hidden />
            ) : (
              <ChevronLeft size={15} aria-hidden />
            )}
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="text-muted hover:text-accent grid size-[44px] shrink-0 place-items-center rounded-full transition-colors"
          >
            <X size={18} aria-hidden />
          </button>
        ) : null}
      </div>

      {/* ------------------------------------------------------------ cta -- */}
      {create ? (
        <div className={cn('shrink-0 pb-4', collapsed ? 'px-2' : 'px-4')}>
          <Link
            to={create.to}
            onClick={onNavigate}
            title={collapsed ? create.label : undefined}
            className={cn(
              /*
               * "ADD A VIDEO" — THE BUTTON RASHID POINTS AT FIRST.
               *
               * It was `wx-gradient`, which is `--wx-accent-gradient` in
               * global.css: violet #AF73DE to blue #5592EE, neither of which is
               * one of his three. Rebuilt here rather than in the token because
               * tokens.css and global.css belong to the lead this session.
               *
               * TWO OF THE THREE, sky into periwinkle, and it ENDS on #C3BEF0
               * so this CTA and a solid `Button variant="primary"` beside it
               * agree about what the primary colour is. Hover steps the whole
               * ramp one notch deeper (peri into `--wx-accent-fill-hover`)
               * instead of brightening, because there is nothing above a pastel
               * to brighten into.
               *
               * The label is `--wx-on-accent-fill`, NOT `text-on-accent`. In
               * the light theme `--wx-on-accent` is #F7F8FC — white — and white
               * on #CADEFC is 1.4:1. Ink on this ramp is above 9:1 at both ends.
               */
              'ease-brand flex min-h-[44px] items-center justify-center gap-2',
              '[background-image:linear-gradient(135deg,var(--wx-brand-sky)_0%,var(--wx-brand-peri)_100%)]',
              'hover:[background-image:linear-gradient(135deg,var(--wx-brand-peri)_0%,var(--wx-accent-fill-hover)_100%)]',
              '[color:var(--wx-on-accent-fill)]',
              'rounded-xl text-[0.8125rem] font-semibold shadow-md transition-[transform,opacity,background-color,border-color,color] duration-300',
              'hover:shadow-lg active:translate-y-px',
              collapsed ? 'w-full px-0' : 'w-full px-4'
            )}
          >
            <Plus size={16} aria-hidden className="shrink-0" />
            <span className={collapsed ? 'sr-only' : undefined}>{create.label}</span>
          </Link>
        </div>
      ) : null}

      {/* ------------------------------------------------------------ nav -- */}
      {/* `wx-scroll-quiet`: it still scrolls, it just stops painting a grey
          stripe down the edge of the brand's own navigation. See global.css. */}
      <nav
        ref={navRef}
        aria-label="Main"
        className={cn(
          'wx-scroll-quiet flex-1 overflow-y-auto pt-1 pb-3',
          collapsed ? 'px-2' : 'px-2.5'
        )}
      >
        {/*
          THE GAP LIVES ON THE HEADING, NOT ON THE GROUP.
          It was `mb-3.5` on every group plus `pb-1` under every heading, which
          on eight groups was about 100px of nothing in a menu 12 items long â€”
          Rashid, 2026-08-21: *"too much gap between and too many sections"*.
          Now the space is a top margin on the heading, so a group WITHOUT one
          (Dashboard, and the creator's profile row) sits straight under the
          list above it instead of paying for a title it does not have.
        */}
        {groups.map((group, i) => (
          /*
           * THE MARGIN IS ON THE GROUP, NOT ON THE HEADING, and that is not a
           * style preference. `first:` means `:first-child` of its own parent,
           * and the heading is always the first child of its group, so
           * `mt-4 first:mt-0` on the heading resolved to `mt-0` every single
           * time and the gap it was supposed to create never existed. Here
           * `first:` refers to the first GROUP, which is what was meant.
           */
          <div
            key={group.label || `group-${i}`}
            className={cn(group.label && 'mt-4 first:mt-0')}
          >
            {collapsed ? (
              // The rule stands in for the heading on the narrow rail, and it
              // is skipped for the same unlabelled groups, so the top of the
              // rail is not a line above a single icon.
              group.label ? (
                <div className="bg-line mx-auto my-2 h-px w-6" aria-hidden />
              ) : null
            ) : group.label ? (
              <p className="text-faint mb-1 px-2.5 font-mono text-[0.625rem] tracking-[0.16em] uppercase">
                {group.label}
              </p>
            ) : null}
            <ul className="grid gap-px">
              {group.items.map((item) => (
                <li key={item.label}>
                  <NavRow
                    item={item}
                    active={isNavItemActive(item, pathname)}
                    collapsed={collapsed}
                    {...(onNavigate ? { onNavigate } : {})}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* ----------------------------------------------------------- user -- */}
      {/* One line: avatar, who you are, and the way out. This used to be a card
          with the name, the email and two chips stacked under it, which on a
          creator read "CREATOR  CREATOR" because the role and the starting tier
          share a word. Role and tier belong on the profile screen, not here.

          The design's footer is a divider with Settings and Logout under it.
          Ours keeps the identity, because a product where you can be signed in
          as two different people in two tabs had better say which one you are. */}
      {/*
        NO `border-t`. Rashid has circled this corner twice. Borders are gone
        product-wide and this was one of the last hard rules left in the shell:
        a dark line straight across a card that is otherwise held together by
        shadow. The footer is separated by space and by its own material now.
      */}
      <div className={cn('shrink-0', collapsed ? 'p-2' : 'p-2.5')}>
        {collapsed ? (
          /*
           * TWO EQUAL CIRCLES, STACKED. The avatar was 36px and the sign-out
           * 44px, centred independently, so a narrow rail ended in two
           * different-sized blobs that did not line up with each other or with
           * the 44px nav icons above them. Both are 44px now, which is also the
           * tap floor, so the column reads as one stack.
           */
          <div className="grid justify-items-center gap-2">
            {accountMenu ? (
              <button
                type="button"
                data-account-chip
                aria-haspopup="dialog"
                onClick={() => {
                  onNavigate?.();
                  openAccountMenu();
                }}
                title={`${name || 'Your account'}${email ? ` (${email})` : ''}`}
                className="grid size-11 place-items-center rounded-full [background-color:var(--wx-accent-fill)] font-mono text-[0.8125rem] font-bold [color:var(--wx-on-accent-fill)] uppercase"
              >
                {initial}
                <span className="sr-only">Your account</span>
              </button>
            ) : (
              <p
                title={`${name || 'Signed in'}${email ? ` (${email})` : ''}`}
                /* Avatar = FILL. His colour, ink initial. See CreatorFace. */
                className="grid size-11 place-items-center rounded-full [background-color:var(--wx-accent-fill)] font-mono text-[0.8125rem] font-bold [color:var(--wx-on-accent-fill)] uppercase"
              >
                {initial}
              </p>
            )}
            <button
              type="button"
              disabled={signingOut}
              onClick={onSignOut}
              title="Sign out"
              className="wx-neo-raised-sm wx-neo-press text-muted hover:text-danger grid size-11 place-items-center rounded-full transition-colors duration-200 disabled:opacity-50"
            >
              <LogOut size={15} aria-hidden />
              <span className="sr-only">Sign out</span>
            </button>
          </div>
        ) : (
          /* `wx-neo-inset`, not `wx-glass-panel`: the glass utility still draws
             a 1px edge, and this is a well at the foot of the rail. */
          <div className="wx-neo-inset flex items-center gap-2.5 rounded-xl py-2 pr-1.5 pl-2.5">
            {accountMenu ? (
              /* THE CHIP IS THE ACCOUNT MENU'S BUTTON for creators. On a phone
                 this is the drawer, which closes first so its focus trap does
                 not fight the menu; the menu then opens centred above the bar. */
              <button
                type="button"
                data-account-chip
                aria-haspopup="dialog"
                onClick={() => {
                  onNavigate?.();
                  openAccountMenu();
                }}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left"
              >
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded-full [background-color:var(--wx-accent-fill)] font-mono text-[0.8125rem] font-bold [color:var(--wx-on-accent-fill)] uppercase"
                >
                  {initial}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-semibold">
                    {name || 'Your account'}
                  </span>
                  <span className="text-faint block truncate text-[0.6875rem]">{email}</span>
                </span>
              </button>
            ) : (
              <>
                <span
                  aria-hidden
                  /* Avatar = FILL. His colour, ink initial. See CreatorFace. */
                  className="grid size-9 shrink-0 place-items-center rounded-full [background-color:var(--wx-accent-fill)] font-mono text-[0.8125rem] font-bold [color:var(--wx-on-accent-fill)] uppercase"
                >
                  {initial}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-semibold">
                    {name || 'Signed in'}
                  </span>
                  <span className="text-faint block truncate text-[0.6875rem]">{email}</span>
                </span>
              </>
            )}
            <button
              type="button"
              disabled={signingOut}
              onClick={onSignOut}
              title="Sign out"
              // Turns danger on hover, the way the design's Logout does. It is
              // the one row in here that ends a session.
              className="wx-neo-raised-sm wx-neo-press text-muted hover:text-danger grid size-11 shrink-0 place-items-center rounded-full transition-colors duration-200 disabled:opacity-50"
            >
              <LogOut size={15} aria-hidden />
              <span className="sr-only">{signingOut ? 'Signing out' : 'Sign out'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function NavRow({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  /*
   * TIGHTENED TWICE. 2026-08-16 took it from py-3 / px-4 / 14px in a 280px rail
   * to py-2 / px-3 / 13px in 240px. 2026-08-21 took the HEIGHT down, which is
   * what Rashid was actually looking at when he said the menu was boring and
   * gappy: every row was 44px tall on a 1440px laptop, and 44px is a thumb, not
   * a mouse.
   *
   * SO 44px ON A PHONE AND 34px ABOVE IT. The floor is the minimum tap target
   * and it does not move where a finger is doing the pointing; it is simply not
   * owed to a cursor. `40rem` is the same breakpoint `wx-tap-row` uses for
   * exactly this trade in the filter bars, so the two cannot drift.
   */
  const base = cn(
    'ease-brand relative flex min-h-[44px] items-center gap-2.5 rounded-lg py-2 text-[0.8125rem]',
    'sm:min-h-[34px] sm:py-1.5',
    'transition-[transform,opacity,background-color,border-color,color] duration-200',
    collapsed ? 'justify-center px-0' : 'px-3'
  );

  // Not built yet. Rendered as text, never as a link: a nav item that navigates
  // to nothing is worse than one that plainly says "not yet".
  if (!item.to) {
    return (
      <span
        className={cn(base, 'text-faint cursor-default')}
        aria-disabled="true"
        title={collapsed ? `${item.label} (${item.soon ?? 'later'})` : undefined}
      >
        <item.icon size={16} aria-hidden className="shrink-0" />
        {collapsed ? (
          <span className="sr-only">
            {item.label}, {item.soon ?? 'not yet built'}
          </span>
        ) : (
          <>
            <span className="truncate">{item.label}</span>
            {/* The "soon"/"later" pill. Was an outlined chip, the last border
                in the rail; the inset well says "not yet" better anyway,
                because it reads as recessed rather than as another button. */}
            {item.soon ? (
              <span className="wx-neo-inset text-faint ml-auto shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[0.5625rem] tracking-[0.1em] uppercase">
                {item.soon}
              </span>
            ) : null}
          </>
        )}
      </span>
    );
  }

  /*
   * Begin the download on the way to the click, not after it. See
   * `prefetchRoute` for why, and for why it is only half the fix.
   *
   * `pointerenter` covers mouse and stylus. `touchstart` fires on a phone the
   * moment a finger lands, which is 100ms or so before the click resolves, so
   * even touch gets a small head start. `focus` covers the keyboard.
   */
  const warm = () => {
    if (item.to) prefetchRoute(item.to);
  };

  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      onPointerEnter={warm}
      onTouchStart={warm}
      onFocus={warm}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        base,
        /* NEOMORPHIC, PRISM 2026-10-08. The current page is PRESSED INTO the
           rail rather than tinted on top of it â€” in a soft material the way you
           say "you are here" is that the surface has been pushed in. The accent
           ink and the indicator bar still carry the meaning, so the state is
           never conveyed by depth alone, which would vanish under
           `forced-colors`. Everything else lifts very slightly on hover. */
        active
          ? 'wx-neo-pressed text-accent font-semibold'
          : 'text-muted hover:wx-neo-raised-sm hover:text-text'
      )}
    >
      {/*
        THE INDICATOR BAR, which is the piece of the design that makes the
        active row read at a glance rather than as a slightly different shade.
        The design puts it on the outer edge; it sits on the INNER edge here so
        it survives the collapsed rail, where the outer edge is the screen.
      */}
      {active ? (
        <span
          aria-hidden
          className="bg-accent absolute inset-y-1 left-0 w-[3px] rounded-full"
        />
      ) : null}
      <item.icon size={17} aria-hidden className="shrink-0" />
      <span className={collapsed ? 'sr-only' : 'truncate'}>{item.label}</span>
    </Link>
  );
}
