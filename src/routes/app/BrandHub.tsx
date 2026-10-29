import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { m } from 'motion/react';
import { ArrowLeft, Package } from 'lucide-react';
import { DataError } from '@/components/ui/DataState';
import { ButtonLink } from '@/components/ui/Button';
import { ApplyDialog } from '@/components/creator/ApplyDialog';
import { LockedUntilApproved } from '@/components/creator/LockedUntilApproved';
import { OfferCard } from '@/components/creator/OfferCard';
import { EarnGrid, EarnPanel } from '@/components/creator/earn/EarnPanel';
import { BrandMark } from '@/components/creator/brand/BrandHeader';
import { Brands } from '@/routes/app/Brands';
import { ContestsView } from '@/routes/app/Contests';
import { useAuth } from '@/lib/auth/auth-context';
import { useProfile } from '@/lib/auth/useProfile';
import {
  useCreatorBrand,
  useCreatorOffers,
  useCreatorProducts,
  type CreatorBrand,
  type CreatorOffer,
  type CreatorProduct,
} from '@/lib/creator/useCreatorBrands';
import { useCreatorContests, type CreatorContest } from '@/lib/creator/useCreatorContests';
import {
  useMyOfferApplications,
  type MyOfferApplication,
} from '@/lib/creator/useOfferApplications';
import { useCatalogueLive } from '@/lib/creator/useCatalogueLive';
import { useMyJobProgress, type JobProgress } from '@/lib/work/job-progress';
import { useTheme } from '@/components/theme/theme-context';
import { money, percent } from '@/lib/money';
import {
  DEFAULT_BRAND_COLOR,
  deriveBrandTheme,
  paletteToAccentVars,
  readBrandThemeConfig,
} from '@/lib/brand-theme';

/**
 * A BRAND'S PAGE: who it is, and what it is offering her. One scroll.
 *
 * No section control, no switcher, no figures of hers. A section with nothing
 * in it is not drawn. The way to another brand is back to the marketplace.
 *
 * `/app/brands` (no slug) is the marketplace itself. Old `?section=` links
 * land here and the parameter is ignored.
 *
 * WHAT IT NEVER READS: the client behind a brand, or the budget allocated to
 * it. Both live in `brand_commercials` behind a staff-only policy, and no hook
 * this file touches selects either.
 */
export function BrandHub() {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) return <Brands />;
  return <BrandPage slug={slug} />;
}

function BrandPage({ slug }: { slug: string }) {
  const { claims } = useAuth();
  const { data: profile } = useProfile();
  const role = profile?.role ?? claims?.role;
  const approved = role === 'creator' || role === 'ops' || role === 'admin';

  // Admin edits to brands, offers and products land here without a reload.
  useCatalogueLive();

  const { data: brand, isLoading, isError, refetch } = useCreatorBrand(slug);
  const { data: offers, isLoading: offersLoading } = useCreatorOffers(brand?.id);
  const { data: products, isLoading: productsLoading } = useCreatorProducts(brand?.id);
  const { data: mine } = useMyOfferApplications(brand?.id);
  const { data: progress } = useMyJobProgress();
  const {
    contests,
    isLoading: contestsLoading,
    isError: contestsError,
  } = useCreatorContests(brand?.id);
  const queryClient = useQueryClient();
  const retryContests = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['creator', 'contests'] }),
      queryClient.invalidateQueries({ queryKey: ['creator', 'contest-entries'] }),
    ]);

  if (!approved) return <LockedUntilApproved />;

  if (isLoading) return <PageSkeleton />;

  if (isError) {
    return (
      <DataError
        title="This brand would not load"
        body="Try again in a moment."
        onRetry={() => refetch()}
      />
    );
  }

  if (!brand) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-[0.9375rem] font-semibold">Brand not found</p>
        <ButtonLink to="/app/brands" variant="secondary" size="sm">
          All brands
        </ButtonLink>
      </div>
    );
  }

  if (offersLoading || productsLoading || contestsLoading) {
    return (
      <AccentScope brand={brand}>
        <BackLink />
        <BrandHead brand={brand} />
        <PageSkeleton bare />
      </AccentScope>
    );
  }

  return (
    <BrandPageView
      brand={brand}
      offers={offers ?? []}
      mine={mine ?? []}
      progress={progress}
      products={products ?? []}
      contests={contests}
      contestsError={contestsError}
      retryContests={retryContests}
      isCreator={role === 'creator'}
    />
  );
}

/** The page with its data handed in, so `/dev/brand-hub` can draw the real thing. */
export function BrandPageView({
  brand,
  offers,
  mine,
  progress,
  products,
  contests,
  contestsError = false,
  retryContests = () => {},
  isCreator = true,
}: {
  brand: CreatorBrand;
  offers: CreatorOffer[];
  mine: MyOfferApplication[];
  progress: Map<string, JobProgress> | undefined;
  products: CreatorProduct[];
  contests: CreatorContest[];
  contestsError?: boolean;
  retryContests?: () => void | Promise<unknown>;
  isCreator?: boolean;
}) {
  const [applyingTo, setApplyingTo] = useState<CreatorOffer | null>(null);

  // The newest request per offer: she can be declined and ask again.
  const latest = useMemo(() => {
    const map = new Map<string, MyOfferApplication>();
    for (const r of mine) if (!map.has(r.offer_id)) map.set(r.offer_id, r);
    return map;
  }, [mine]);

  return (
    <AccentScope brand={brand}>
      <BackLink />
      <BrandHead brand={brand} />

      {offers.length > 0 ? (
        <Section title="Offers">
          <EarnPanel className="mt-2">
            <EarnGrid min="20rem" className="mt-0">
              {offers.map((offer, i) => (
                <Rise key={offer.id} index={i}>
                  <OfferCard
                    offer={offer}
                    request={latest.get(offer.id)}
                    progress={progress?.get(latest.get(offer.id)?.id ?? '')}
                    grouped
                    onApply={() => setApplyingTo(offer)}
                  />
                </Rise>
              ))}
            </EarnGrid>
          </EarnPanel>
        </Section>
      ) : null}

      {contests.length > 0 ? (
        <Section title="Contests">
          <div className="mt-1">
            <ContestsView
              approved
              embedded
              isCreator={isCreator}
              contests={contests}
              isLoading={false}
              isError={contestsError}
              retry={retryContests}
            />
          </div>
        </Section>
      ) : null}

      {products.length > 0 ? (
        <Section title="Products">
          <EarnPanel className="mt-2">
            <EarnGrid min="13rem" className="mt-0">
              {products.map((product, i) => (
                <Rise key={product.id} index={i}>
                  <ProductTile product={product} />
                </Rise>
              ))}
            </EarnGrid>
          </EarnPanel>
        </Section>
      ) : null}

      {applyingTo ? (
        <ApplyDialog
          offer={applyingTo}
          brandName={brand.name}
          onClose={() => setApplyingTo(null)}
        />
      ) : null}
    </AccentScope>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="font-display px-1 text-[1.125rem] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Rise({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <m.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: 'easeOut', delay: Math.min(index, 6) * 0.04 }}
      className="min-w-0"
    >
      {children}
    </m.li>
  );
}

function BackLink() {
  return (
    <Link
      to="/app/brands"
      className="text-muted hover:text-text -ml-1 inline-flex min-h-11 w-fit items-center gap-1.5 px-1 text-[0.8125rem] font-semibold transition-colors"
    >
      <ArrowLeft size={15} aria-hidden />
      All brands
    </Link>
  );
}

/** Logo, name and a line. No panel: the page ground carries it. */
function BrandHead({ brand }: { brand: CreatorBrand }) {
  const line = brand.tagline ?? brand.description;
  return (
    <header className="flex items-center gap-4 px-1">
      <BrandMark brand={brand} className="size-16" />
      <div className="min-w-0">
        <h1 className="text-[1.5rem] leading-tight font-bold break-words">{brand.name}</h1>
        {line ? (
          <p className="text-muted mt-1 line-clamp-2 text-[0.9375rem] leading-snug">{line}</p>
        ) : null}
      </div>
    </header>
  );
}

/** A product and the rate she would earn on it. Never multiplied into money. */
function ProductTile({ product }: { product: CreatorProduct }) {
  const rate = percent(product.commission_rate);
  return (
    <div className="wx-neo-raised-sm flex h-full flex-col overflow-hidden rounded-xl">
      <div className="wx-neo-inset relative aspect-square overflow-hidden shadow-[0_8px_18px_-10px_rgba(0,0,0,0.65)]">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <span className="grid size-full place-items-center">
            <Package size={24} aria-hidden className="text-faint" />
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <p className="text-[0.9375rem] leading-snug font-semibold break-words">{product.name}</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
          {product.price !== null ? (
            <p className="font-display text-muted text-[0.875rem]">
              {money(product.price, product.currency)}
            </p>
          ) : (
            <span />
          )}
          {rate ? (
            <span className="text-accent text-[0.75rem] font-semibold">
              <span className="font-display wx-numeric text-[1rem] font-bold">{rate}</span>{' '}
              commission
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PageSkeleton({ bare = false }: { bare?: boolean }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      {bare ? null : <div className="wx-skeleton h-11 w-28 rounded-lg" />}
      {bare ? null : <div className="wx-skeleton h-16 w-72 max-w-full rounded-xl" />}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="wx-skeleton h-56 rounded-xl" />
        ))}
      </ul>
    </div>
  );
}

/**
 * THE BRAND, AS AN ACCENT. It sets the accent-family tokens on THIS element, so
 * they reach only this page's subtree and leaving the route undoes them. It
 * must not carry a `backdrop-filter`. `data-brand-world` is what
 * `scripts/shots-hub.mjs` finds the page by.
 */
function AccentScope({
  brand,
  children,
}: {
  brand: CreatorBrand;
  children: React.ReactNode;
}) {
  const { resolved } = useTheme();
  const vars = useMemo(() => {
    const theme = deriveBrandTheme(
      brand.brand_color ?? DEFAULT_BRAND_COLOR,
      readBrandThemeConfig(brand.theme)
    );
    return paletteToAccentVars(resolved === 'dark' ? theme.dark : theme.light);
  }, [brand.brand_color, brand.theme, resolved]);

  return (
    <div
      data-brand-world={brand.slug}
      style={vars as React.CSSProperties}
      className="flex min-w-0 flex-col gap-4"
    >
      {children}
    </div>
  );
}
