#!/usr/bin/env node
/**
 * DEV ONLY. August's videos for the Penetrex retainer, as real content.
 *
 * THE SOURCE. Rashid keeps one Google Sheet per creator, linked from the
 * Content column of the Collabs tab. Twenty of the forty-one have one, and each
 * is a stack of BLOCKS, one per batch, each starting on a row whose second cell
 * is `Video Links` with the month written on that header row. Read 2026-08-19;
 * the rows below are transcribed from the blocks labelled **August**.
 *
 * WHY THE LABEL AND NOT THE DATE IN THE VIDEO ID. Rashid's call, and it is the
 * right one: "july 30 and aug 1 these dates can be a bit off because of
 * timezone issues, so trust the sheet data". Gunnar's August batch opens with a
 * video posted 30 July and it belongs to August's work. Two readings were
 * compared before asking him, and they disagree a lot: the label differs from
 * the id-derived month on 199 of 407 labelled rows, because the label marks the
 * batch a video was commissioned in rather than the day it went up. Brooke
 * Jackson's entire 51-video sheet, for instance, is one block labelled "April"
 * that actually spans April to August.
 *
 * WHAT IS HERE: 79 videos across 11 creators, every one with its ad code. The
 * other 366 links on those sheets are April to July and are deliberately left
 * out.
 *
 * ONE THING LEFT OUT ON PURPOSE. Jen Honest's last block carries six videos
 * posted 11 to 18 August, straight after her July block, but the sheet gives it
 * no month at all. Guessing would be reading her mind rather than her sheet, so
 * it waits for Rashid.
 *
 * IT WALKS THE REAL PATH, both functions the product uses:
 *
 *   submit_content   as the CREATOR, exactly as adding a link on their own
 *                    screen does
 *   review_content   as the ADMIN, approving it
 *
 * `p_embed_id` is the important argument. It is TikTok's item id, and it is the
 * ONLY join between a person and the money: `tiktok_video_daily` is keyed by
 * (item_id, stat_date) and has no reference to a creator at all. Passing it
 * here is what makes real ad spend and GMV appear on a creator's screen without
 * a single TikTok API call.
 *
 * NO THUMBNAILS. TikTok's oEmbed endpoint is unreachable from this machine, so
 * the preview columns go in null, which the schema explicitly allows: "TikTok
 * being slow must never cost a creator their upload". `refresh_content_preview`
 * fills them in later from a browser.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/seed/seed-august-content.mjs
 *   ... --clean            removes only these videos again
 *   ... --submitted-only   leave them waiting in the review queue instead of
 *                          approving them
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../lib/dev-guard.mjs';

/** One row per video, from the August blocks of the per-creator sheets. */
const VIDEOS = [
  // aarontopfinds, 6 of a 10 video deal
  {
    handle: 'aarontopfinds',
    url: 'https://www.tiktok.com/@aarontopfinds/video/7670315704591174943',
    itemId: '7670315704591174943',
    adCode: '#5/W2wjEnEFM1ir7Lly7V4JnbM0HQAHaW3dnwZgflcXs3iqarxjQLSLRYVBaPFfM=',
    postedAt: '2026-08-04T23:02:22.000Z',
  },
  {
    handle: 'aarontopfinds',
    url: 'https://www.tiktok.com/@aarontopfinds/video/7671047209890155806',
    itemId: '7671047209890155806',
    adCode: '#w8p5+35+RxIVrYZK6AeQBiDBYiJIbJgVsVTosHAFnLR5dspVlSWIXqlxse+mv9k=-',
    postedAt: '2026-08-06T22:20:59.000Z',
  },
  {
    handle: 'aarontopfinds',
    url: 'https://www.tiktok.com/@aarontopfinds/video/7671409453299748126',
    itemId: '7671409453299748126',
    adCode: '#pxTI3y6ZluyOoLWDM5b09euk8hGXcGZgT3Bn7nQfiNaApumiQ32Y7F+XQXk9HE8=',
    postedAt: '2026-08-07T21:46:40.000Z',
  },
  {
    handle: 'aarontopfinds',
    url: 'https://www.tiktok.com/@aarontopfinds/video/7671867251150114078',
    itemId: '7671867251150114078',
    adCode: '#u5vnfPUBN4nr5pcb+vRqu/Hc3yW2/DKigmksp1ccb0EF8Tp4QBxsm1bl0iI1BhY=',
    postedAt: '2026-08-09T03:23:10.000Z',
  },
  {
    handle: 'aarontopfinds',
    url: 'https://www.tiktok.com/@aarontopfinds/video/7672584197575396638',
    itemId: '7672584197575396638',
    adCode: '#FaKVtsY54S/gLh9pJR1+XFkFSAW5e/HYld7qPsl3ezXm43NEiFg1zGSWdcrG+v0=',
    postedAt: '2026-08-11T01:45:17.000Z',
  },
  {
    handle: 'aarontopfinds',
    url: 'https://www.tiktok.com/@aarontopfinds/video/7673348668136672542',
    itemId: '7673348668136672542',
    adCode: '#iXVYdy2U7SmI11BghzyGctHqXggl5sw+fuGjPq/amU76SpFVay64vNiFjsgEerw=',
    postedAt: '2026-08-13T03:11:49.000Z',
  },
  // holistic.rx, 10 of a 10 video deal
  {
    handle: 'holistic.rx',
    url: 'https://www.tiktok.com/@holistic.rx/video/7670220486399315231',
    itemId: '7670220486399315231',
    adCode: '#HYxW31PLWzdpeAeLt7+c024NairO1oIqYWotZVXrW9Tb6YeTezRHSiJRZfcsID8=',
    postedAt: '2026-08-04T16:52:52.000Z',
  },
  {
    handle: 'holistic.rx',
    url: 'https://www.tiktok.com/@holistic.rx/video/7671654551409233182',
    itemId: '7671654551409233182',
    adCode: '#rTgw9RzkKa5Xqrgro0RTX8Nb9zAGOdoYi5yZjTMiYEUgpxVmG/uGqbsn+RaaZXk=',
    postedAt: '2026-08-08T13:37:47.000Z',
  },
  {
    handle: 'holistic.rx',
    url: 'https://www.tiktok.com/@holistic.rx/video/7672087397886119199',
    itemId: '7672087397886119199',
    adCode: '#ASI2+Th1PtAtKBPK9N0Q25kZiua1GQ+P4eoJzofumFqLZAKsPdFDDrObIoaO+30=',
    postedAt: '2026-08-09T17:37:27.000Z',
  },
  {
    handle: 'holistic.rx',
    url: 'https://www.tiktok.com/@holistic.rx/video/7672411806010199327',
    itemId: '7672411806010199327',
    adCode: '#3E29crAzHCPZWdac0tbba9FzGj0npaEfUHhSXjNa2dKX2rEmrKbTshdLUPx2qwI=',
    postedAt: '2026-08-10T14:36:19.000Z',
  },
  {
    handle: 'holistic.rx',
    url: 'https://www.tiktok.com/@holistic.rx/video/7672536577368722719',
    itemId: '7672536577368722719',
    adCode: '#YaUbQQyGyXe44giusNuWuTPWdCIv6M7RHw8H2oAA5uw+wl3DYMlm0CibyER3zkk=',
    postedAt: '2026-08-10T22:40:29.000Z',
  },
  {
    handle: 'holistic.rx',
    url: 'https://www.tiktok.com/@holistic.rx/video/7672767724262591774',
    itemId: '7672767724262591774',
    adCode: '#zLojpQ658rX8/LNBZvVtRW9Ct9PfmzTuZA3MtMohCYrwb8HWg76Kv4fmPEoZZI0=',
    postedAt: '2026-08-11T13:37:27.000Z',
  },
  {
    handle: 'holistic.rx',
    url: 'https://www.tiktok.com/@holistic.rx/video/7669965819081755934',
    itemId: '7669965819081755934',
    adCode: '#zXwlbeaerIBTxwIrR6A/LAdCXuY7n/qVWxxS2OvjJEDJrn0MjqEi7ShkvO+8J4s=',
    postedAt: '2026-08-04T00:24:38.000Z',
  },
  {
    handle: 'holistic.rx',
    url: 'https://www.tiktok.com/@holistic.rx/video/7673291592337296670',
    itemId: '7673291592337296670',
    adCode: '#hVwbTni8H7SDLrBh6U+qtSUDv1nzx28PR79Oihb+TYieLeABtbGNcmXH6JCW5VQ=',
    postedAt: '2026-08-12T23:30:20.000Z',
  },
  {
    handle: 'holistic.rx',
    url: 'https://www.tiktok.com/@holistic.rx/video/7673551142894259486',
    itemId: '7673551142894259486',
    adCode: '#5u6mWmtB5kkeDRe6i3sRG1RfF/pF17YhcUkg3D2QVtEZy4FULW+COxq5sH9uY7A=',
    postedAt: '2026-08-13T16:17:31.000Z',
  },
  {
    handle: 'holistic.rx',
    url: 'https://www.tiktok.com/@holistic.rx/video/7673830792505740575',
    itemId: '7673830792505740575',
    adCode: '#dKwz4WB4RftiCCL1+dSTP+XSJxZbIy7mP/5G/l7IJZdouOkx+XQq9lwLUHCwPVw=',
    postedAt: '2026-08-14T10:22:42.000Z',
  },
  // johnhidalgo26, 10 of a 10 video deal
  {
    handle: 'johnhidalgo26',
    url: 'https://www.tiktok.com/@johnhidalgo26/video/7669192775308446989',
    itemId: '7669192775308446989',
    adCode: '#gJ9861e7BSKDMGWTR3zeAbb/2aCGvz0AWzGmRs3duFov4xbuRAFXcPBMMpA1KsY=',
    postedAt: '2026-08-01T22:24:50.000Z',
  },
  {
    handle: 'johnhidalgo26',
    url: 'https://www.tiktok.com/@johnhidalgo26/video/7669537253642816781',
    itemId: '7669537253642816781',
    adCode: '#3eAG0jFeb1Pi4X9MvowAO7XbgBH5bE052Ki3Bq557+wFLWi2C+FDiliY+rzTN18=',
    postedAt: '2026-08-02T20:41:35.000Z',
  },
  {
    handle: 'johnhidalgo26',
    url: 'https://www.tiktok.com/@johnhidalgo26/video/7669960991253286158',
    itemId: '7669960991253286158',
    adCode: '#GJhycMAk+YS+nsqhfFMknRLjsFelEhwMUUOAT7sCj3Fb8Jtzgq2KlzCUB+x1ky0=',
    postedAt: '2026-08-04T00:05:54.000Z',
  },
  {
    handle: 'johnhidalgo26',
    url: 'https://www.tiktok.com/@johnhidalgo26/video/7670319918490848525',
    itemId: '7670319918490848525',
    adCode: '#nkELZunWJHbkxZfxcmBcnX4drsuS0MgwSSSLOk837iGGpzPnmjc9FlEsnLVOhWE=',
    postedAt: '2026-08-04T23:18:43.000Z',
  },
  {
    handle: 'johnhidalgo26',
    url: 'https://www.tiktok.com/@johnhidalgo26/video/7671060495482244365',
    itemId: '7671060495482244365',
    adCode: '#HaX4NUp7wyfvF3urZpCWqoJUb3yNBEYYM0p1nPbXWK+Eg/wTDbHJurjJpSWlTzY=',
    postedAt: '2026-08-06T23:12:32.000Z',
  },
  {
    handle: 'johnhidalgo26',
    url: 'https://www.tiktok.com/@johnhidalgo26/video/7671307595122035981',
    itemId: '7671307595122035981',
    adCode: '#Ku7inTMHNYbKNdiOrwUJ3EHJZJpV4G3ChZKjeXVpPSgnaYv7In0YgUZc7lsnsJI=',
    postedAt: '2026-08-07T15:11:25.000Z',
  },
  {
    handle: 'johnhidalgo26',
    url: 'https://www.tiktok.com/@johnhidalgo26/video/7671376472271064334',
    itemId: '7671376472271064334',
    adCode: '#Gn+NYUX5WAzgSht6ycaBc1qRfkF7hlrXJw8s7cOql/K/9FCxbpyRWoBkbv9HCgU=',
    postedAt: '2026-08-07T19:38:41.000Z',
  },
  {
    handle: 'johnhidalgo26',
    url: 'https://www.tiktok.com/@johnhidalgo26/video/7672019724477222157',
    itemId: '7672019724477222157',
    adCode: '#nKktO6Luvtl6529GYvkm9eWtzGY34OwwDJwDmb2UAw3rZ9tcYcTvOg28k5284uQ=',
    postedAt: '2026-08-09T13:14:50.000Z',
  },
  {
    handle: 'johnhidalgo26',
    url: 'https://www.tiktok.com/@johnhidalgo26/video/7672348019378900238',
    itemId: '7672348019378900238',
    adCode: '#revZ2mCuSjdMEoMXkKq/Z8g4Sg11afdqJM2MhVYArLwAFXrEJhw3rhoAbYvnPUM=',
    postedAt: '2026-08-10T10:28:47.000Z',
  },
  {
    handle: 'johnhidalgo26',
    url: 'https://www.tiktok.com/@johnhidalgo26/video/7673091434689400077',
    itemId: '7673091434689400077',
    adCode: '#wK6tugwjteHHIeF12q+kC5Rhh4F6ZhOFNG8XghydgX/+lGjN0d8nnYYK+Xg8TTo=',
    postedAt: '2026-08-12T10:33:37.000Z',
  },
  // life_w_boyz, 5 of a 5 video deal
  {
    handle: 'life_w_boyz',
    url: 'https://www.tiktok.com/@life_w_boyz/video/7672519821824757023',
    itemId: '7672519821824757023',
    adCode: '#md85v6Hxtuec7bq8xuCNBeME2c+FWIsqipqmTJhcmL9K+bzCfgD+0VokeO8JJ7s=',
    postedAt: '2026-08-10T21:35:28.000Z',
  },
  {
    handle: 'life_w_boyz',
    url: 'https://www.tiktok.com/@life_w_boyz/video/7672536369369009439',
    itemId: '7672536369369009439',
    adCode: '#58rPMKqJGkiUbWFPPRO2SXq2twLzoEu/WKkCfpWP6V4c+YJ3cBN3gTVXrM9Sw0g=',
    postedAt: '2026-08-10T22:39:41.000Z',
  },
  {
    handle: 'life_w_boyz',
    url: 'https://www.tiktok.com/@life_w_boyz/video/7672538212044197151',
    itemId: '7672538212044197151',
    adCode: '#3sOWxNsSuvRCJDGCKIhB3+C2hoXiREAy9bp5n2XERkmgMdAdvpob0pFSl0fHeac=',
    postedAt: '2026-08-10T22:46:50.000Z',
  },
  {
    handle: 'life_w_boyz',
    url: 'https://www.tiktok.com/@life_w_boyz/video/7672540872931577119',
    itemId: '7672540872931577119',
    adCode: '#TPOSxSRRLDyk8jPvK87ShEXgeZP8frgriXf/N82zZYG+aMKgP8nXWs6ZqSsVN6Y=',
    postedAt: '2026-08-10T22:57:09.000Z',
  },
  {
    handle: 'life_w_boyz',
    url: 'https://www.tiktok.com/@life_w_boyz/video/7672560824166190366',
    itemId: '7672560824166190366',
    adCode: '#8f8ulF4BD8UDjNZlqQ5U1dZcnF8IhhMpfHOg/tQFJntiXuflM5naVcmlCrCQ53c=',
    postedAt: '2026-08-11T00:14:35.000Z',
  },
  // lowbacklab, 3 of a 10 video deal
  {
    handle: 'lowbacklab',
    url: 'https://www.tiktok.com/@lowbacklab/video/7668334500404940063',
    itemId: '7668334500404940063',
    adCode: '#xuNmN8afrPLU9MHzPfe3nqGbdFKfKaC+Lbb1O8gVnYY3zTOt9/bXBZHIMC1hY38=',
    postedAt: '2026-07-30T14:54:17.000Z',
  },
  {
    handle: 'lowbacklab',
    url: 'https://www.tiktok.com/@lowbacklab/video/7670601047387295007',
    itemId: '7670601047387295007',
    adCode: '#ANFAV3V6+RuYmCaAngKv1WfEFC+pRId3bqqCqCKhUabM/2O1K/SI8ru9rJZ2v1k=',
    postedAt: '2026-08-05T17:29:39.000Z',
  },
  {
    handle: 'lowbacklab',
    url: 'https://www.tiktok.com/@lowbacklab/video/7675367673764547870',
    itemId: '7675367673764547870',
    adCode: '#WP7Cr6w58BR2LeJm+FpN5MQ9EAk+q0gTOzTSXMjszYRqT8bb0O+ayr5Udt5ZkGs=',
    postedAt: '2026-08-18T13:46:35.000Z',
  },
  // nikkistiktokshop, 9 of a 10 video deal
  {
    handle: 'nikkistiktokshop',
    url: 'https://www.tiktok.com/@nikkistiktokshop/video/7672469590261222669',
    itemId: '7672469590261222669',
    adCode: '#DvgMn2O0XsKr05NaIdCpeX8qq20rus1yNvtYj9d1bULmnsG1yhIedO5bhY0HMHw=',
    postedAt: '2026-08-10T18:20:33.000Z',
  },
  {
    handle: 'nikkistiktokshop',
    url: 'https://www.tiktok.com/@nikkistiktokshop/video/7672888326738808078',
    itemId: '7672888326738808078',
    adCode: '#D3oPMNXBYe5AkkhAI8R4HoL4ePrKHuodVl3DfqL/8gGLKTIonmiKrA/aF6kKCrg=',
    postedAt: '2026-08-11T21:25:27.000Z',
  },
  {
    handle: 'nikkistiktokshop',
    url: 'https://www.tiktok.com/@nikkistiktokshop/video/7673576021945273613',
    itemId: '7673576021945273613',
    adCode: '#80bXgHsxmPkbV/EuYe9qS2dCuxySVJxELdJoET8H2CxtB2oAqDfrav0n57OLgS0=',
    postedAt: '2026-08-13T17:54:04.000Z',
  },
  {
    handle: 'nikkistiktokshop',
    url: 'https://www.tiktok.com/@nikkistiktokshop/video/7674055068802354446',
    itemId: '7674055068802354446',
    adCode: '#M/uIQCPYkBwLIeu1rJFET/lqqJ5GgSIvSaxTlFr7//HEltqcMdvX5Xku+PLybt0=',
    postedAt: '2026-08-15T00:53:01.000Z',
  },
  {
    handle: 'nikkistiktokshop',
    url: 'https://www.tiktok.com/@nikkistiktokshop/video/7674430327955148045',
    itemId: '7674430327955148045',
    adCode: '#c/1t13HR+Zm5xHEkvo6Pbuyjf16n5m82ik2yahLNHjiOGmQ86iiokpFRnNvAkoY=',
    postedAt: '2026-08-16T01:09:12.000Z',
  },
  {
    handle: 'nikkistiktokshop',
    url: 'https://www.tiktok.com/@nikkistiktokshop/video/7674777543085493518',
    itemId: '7674777543085493518',
    adCode: '#mqtN+Q3w/6zcVolC4j2YBPKuE2oW6Gd/fL9stilPXtD543Fc1jzwxI2yjuQ8aIA=',
    postedAt: '2026-08-16T23:36:35.000Z',
  },
  {
    handle: 'nikkistiktokshop',
    url: 'https://www.tiktok.com/@nikkistiktokshop/video/7675101106866769166',
    itemId: '7675101106866769166',
    adCode: '#SieOZ0MZGY9S2EqCsiyDoM9kcHefhlAE7aRXwY0UoVq9xmCZrrp2wQHySxlpXY4=',
    postedAt: '2026-08-17T20:32:10.000Z',
  },
  {
    handle: 'nikkistiktokshop',
    url: 'https://www.tiktok.com/@nikkistiktokshop/video/7675192439442869518',
    itemId: '7675192439442869518',
    adCode: '#Ov5FRTXfROayB/mSIvkHsKoBCGHX2tVUAhKZOU3E+iueMNyNXsNV5kq4Zv9z4xM=',
    postedAt: '2026-08-18T02:26:35.000Z',
  },
  {
    handle: 'nikkistiktokshop',
    url: 'https://www.tiktok.com/@nikkistiktokshop/video/7675464884376620302',
    itemId: '7675464884376620302',
    adCode: '#tKoUTm1CH9SueR0SZzNFTFyK6mnS9kAJ72po0yinXw92ySf0zQVarC7eCqLBsbY=',
    postedAt: '2026-08-18T20:03:49.000Z',
  },
  // pandanamonium, 6 of a 15 video deal
  {
    handle: 'pandanamonium',
    url: 'https://www.tiktok.com/@pandanamonium/video/7671889317555391757',
    itemId: '7671889317555391757',
    adCode: '#DdH3jdfkRtM9wvdBzFV71yywp4eTSIS3ZGRIwe/JUTc3Z2W+YdOHQKeHB297NPM=',
    postedAt: '2026-08-09T04:48:47.000Z',
  },
  {
    handle: 'pandanamonium',
    url: 'https://www.tiktok.com/@pandanamonium/video/7672192709758602510',
    itemId: '7672192709758602510',
    adCode: '#EVgfBwfblqQ4BJMKQaBNDlg/r9N+D2MI/HdnwZ0LnBGzLT/rQgwqmQQVx/q1hns=',
    postedAt: '2026-08-10T00:26:06.000Z',
  },
  {
    handle: 'pandanamonium',
    url: 'https://www.tiktok.com/@pandanamonium/video/7672600061003533582',
    itemId: '7672600061003533582',
    adCode: '#TQiMvQwJkRm0aBNrGBTF15TLVlw2CroJyyrhZOWRroexLsZ4iIiv9ej3oI3/MuA=',
    postedAt: '2026-08-11T02:46:50.000Z',
  },
  {
    handle: 'pandanamonium',
    url: 'https://www.tiktok.com/@pandanamonium/video/7672594786846641421',
    itemId: '7672594786846641421',
    adCode: '#GfIGARWmgr6UOW3KsHxzkDbkjQlwoVOD14Z8/21TbYUyfLysGwuEUI7fO6VCJA4=',
    postedAt: '2026-08-11T02:26:22.000Z',
  },
  {
    handle: 'pandanamonium',
    url: 'https://www.tiktok.com/@pandanamonium/video/7674071859935055117',
    itemId: '7674071859935055117',
    adCode: '#9EodqLHVjx27IkvrfaItHXJOrWTGJyP/rctEs8rFlmA7gojrTSsCFWV0n3m+hqQ=',
    postedAt: '2026-08-15T01:58:10.000Z',
  },
  {
    handle: 'pandanamonium',
    url: 'https://www.tiktok.com/@pandanamonium/video/7674486634619931917',
    itemId: '7674486634619931917',
    adCode: '#yxQJfIws5F/SwUMTZBpzS9hhFOghWwlRTgGsbxnOAwK2OwTpvZzEjEWlC+NUsZc=',
    postedAt: '2026-08-16T04:47:42.000Z',
  },
  // sarahshopsss, 5 of a 5 video deal
  {
    handle: 'sarahshopsss',
    url: 'https://www.tiktok.com/@sarahshopsss/video/7669566410116418847',
    itemId: '7669566410116418847',
    adCode: '#zhD/5GW94AGLjgbW43x5NbjiwegGGcseJndBy3HT55zl2fBUeMBTjoaOKem2NTc=',
    postedAt: '2026-08-02T22:34:43.000Z',
  },
  {
    handle: 'sarahshopsss',
    url: 'https://www.tiktok.com/@sarahshopsss/video/7669866499623996702',
    itemId: '7669866499623996702',
    adCode: '#DReFcwlrsXOvvUzYNswXQq2cg1Ql9/9GxQiHPbmLBZ9r7m0LGP3kjhA9uq8DlLQ=',
    postedAt: '2026-08-03T17:59:13.000Z',
  },
  {
    handle: 'sarahshopsss',
    url: 'https://www.tiktok.com/@sarahshopsss/video/7670155617205554463',
    itemId: '7670155617205554463',
    adCode: '#r3hoEADdzIwIpgYS/J0bNY8Taw0xE+5JoVKdWMAQLTjHLK3yH6okC/nq5HfACAg=',
    postedAt: '2026-08-04T12:41:09.000Z',
  },
  {
    handle: 'sarahshopsss',
    url: 'https://www.tiktok.com/@sarahshopsss/video/7670653941520076062',
    itemId: '7670653941520076062',
    adCode: '#I2zhbVlmdRAqdqtRG/TiK1I361Gf9D2sc+OSupX5bCKPoZTbWIaGTUAt/sL5lGo=',
    postedAt: '2026-08-05T20:54:54.000Z',
  },
  {
    handle: 'sarahshopsss',
    url: 'https://www.tiktok.com/@sarahshopsss/video/7670887895598779662',
    itemId: '7670887895598779662',
    adCode: '#XSV//rBRqzk58sk+uw4wq/cU+cGNr3gZsHi4YA0pVcbhc21oWCwsISbIE2bE2JU=',
    postedAt: '2026-08-06T12:02:46.000Z',
  },
  // vivianiempire_, 6 of a 10 video deal
  {
    handle: 'vivianiempire_',
    url: 'https://www.tiktok.com/@vivianiempire_/video/7671561869395512589',
    itemId: '7671561869395512589',
    adCode: '#ioRCR2SE6qi/RsxZi/SBdD4pvwQT18c5U2oj5o3eZy7qd69vCwLMnYfzQHcQ2hE=',
    postedAt: '2026-08-08T07:38:07.000Z',
  },
  {
    handle: 'vivianiempire_',
    url: 'https://www.tiktok.com/@vivianiempire_/video/7671561423247396109',
    itemId: '7671561423247396109',
    adCode: '#idiSFswYi11Tv8lfp0CVud/zLZcVMub9XTi+mrQ1YV+nsuJHL+FagEYYknVDGDQ=',
    postedAt: '2026-08-08T07:36:24.000Z',
  },
  {
    handle: 'vivianiempire_',
    url: 'https://www.tiktok.com/@vivianiempire_/video/7671560705262243085',
    itemId: '7671560705262243085',
    adCode: '#BoqGOg5sOohW/Uwl/8W+Mp1tMwwc+H6aF1hZEHUh8UCsK03yNHJhs5GjNZ4HrLs=',
    postedAt: '2026-08-08T07:33:36.000Z',
  },
  {
    handle: 'vivianiempire_',
    url: 'https://www.tiktok.com/@vivianiempire_/video/7671505056218270989',
    itemId: '7671505056218270989',
    adCode: '#IjIRnVkNYz1wBFm/O12DsQNXsbotWES6rj+KMFX/IIjxajYZ3tIdgZtsiL7+X6M=',
    postedAt: '2026-08-08T03:57:40.000Z',
  },
  {
    handle: 'vivianiempire_',
    url: 'https://www.tiktok.com/@vivianiempire_/video/7670955824835005710',
    itemId: '7670955824835005710',
    adCode: '#k5MNgjEtuYJo4LxGfUAXK5Hz21J1tPYtylSAhQcY4jsWjmY8M3VyVjYDFB2uAbA=',
    postedAt: '2026-08-06T16:26:22.000Z',
  },
  {
    handle: 'vivianiempire_',
    url: 'https://www.tiktok.com/@vivianiempire_/video/7671562737813589262',
    itemId: '7671562737813589262',
    adCode: '#0t8y9acr0z2zcJgeA0zjbgjZqrNmK5pquJj2of1FReYp+PotO8qISdf22UzJ/Ag=',
    postedAt: '2026-08-08T07:41:30.000Z',
  },
  // willzzshop, 6 of a 10 video deal
  {
    handle: 'willzzshop',
    url: 'https://www.tiktok.com/@willzzshop/video/7672136367165443341',
    itemId: '7672136367165443341',
    adCode: '#HvU/vifFoZbpC0dsUsQXG9DG7ikzXXmBIezILXz3EAhE4rmagDNdJk3S/t6duPU=',
    postedAt: '2026-08-09T20:47:28.000Z',
  },
  {
    handle: 'willzzshop',
    url: 'https://www.tiktok.com/@willzzshop/video/7672136802433568014',
    itemId: '7672136802433568014',
    adCode: '#7vXakr2uarH5N80hgopl3YEDuJMi35y6eXnHXxNb6P6t6VqdJf2Mtu7ceBWIFvY=',
    postedAt: '2026-08-09T20:49:09.000Z',
  },
  {
    handle: 'willzzshop',
    url: 'https://www.tiktok.com/@willzzshop/video/7672136978036460814',
    itemId: '7672136978036460814',
    adCode: '#7mFzAhlIuxMb+2jSlyPIbcTmBwUJhYxBr07bExssVr/61fmTU31aUJUgZcZMMco=',
    postedAt: '2026-08-09T20:49:50.000Z',
  },
  {
    handle: 'willzzshop',
    url: 'https://www.tiktok.com/@willzzshop/video/7672137345612745998',
    itemId: '7672137345612745998',
    adCode: '#C2D1OtvFV+sleuRq/ESpqvAjGCSmhFnkX6QvwaytalawLzFpLsbfskm9aH/27kI=',
    postedAt: '2026-08-09T20:51:16.000Z',
  },
  {
    handle: 'willzzshop',
    url: 'https://www.tiktok.com/@willzzshop/video/7672137679848475918',
    itemId: '7672137679848475918',
    adCode: '#xyXIYY6a0VtjV4o3NC1seu61F/fy38KloyYIdMnrlO//YlvLVhgSuDHpmSco4bw=',
    postedAt: '2026-08-09T20:52:34.000Z',
  },
  {
    handle: 'willzzshop',
    url: 'https://www.tiktok.com/@willzzshop/video/7672137951089872141',
    itemId: '7672137951089872141',
    adCode: '#oHtPUydK6Ht665dn6kSqZA3tku8PcBADqjhg11K3dxw6z+5pug4FcXeUr/sA3GM=',
    postedAt: '2026-08-09T20:53:37.000Z',
  },
  // xxkissnoblissxx, 13 of a 15 video deal
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7669803195555777822',
    itemId: '7669803195555777822',
    adCode: '#iE5Rg/T65fmsqi2SqvIVmLa78W9ahrXfCzsutdDEdkEjR+gcBzBmxRHGmnHmPDs=',
    postedAt: '2026-08-03T13:53:34.000Z',
  },
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7670184956127186206',
    itemId: '7670184956127186206',
    adCode: '#hc9eq0SFjnyDQCUCmmhLZuWot3BPZDZpWTTlWTuKSxI97xWaTjhV1vgeSqgGj6c=',
    postedAt: '2026-08-04T14:35:00.000Z',
  },
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7670243815638207774',
    itemId: '7670243815638207774',
    adCode: '#jyjiZ3RUJ0xwcOHexu2XQ9dcxqWPSbaSxL+2FgXJkTr7bO7JkKcQE3s4F9qmhHk=',
    postedAt: '2026-08-04T18:23:24.000Z',
  },
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7670546174880779550',
    itemId: '7670546174880779550',
    adCode: '#sTRfyUT/r+SiRLWYZtwtE1GLQw/0I2hXfx4IaNyS5kJ2hv+HvW3VxNTMlF4rK0Q=',
    postedAt: '2026-08-05T13:56:43.000Z',
  },
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7671322903878667550',
    itemId: '7671322903878667550',
    adCode: '#9d2Jsk3zbUB2srM0J2jPoa+3hhYrv/JG4OO8d/0dFoFHc1/o7mlm+HbEjQkWDRg=',
    postedAt: '2026-08-07T16:10:49.000Z',
  },
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7672070640903507231',
    itemId: '7672070640903507231',
    adCode: '#R3j7bn3TSmMYVHKx+PFbIbI3uVT8d7PQ7lIuYA4RYZzAFIpgQjS15PrqYRysLxg=',
    postedAt: '2026-08-09T16:32:25.000Z',
  },
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7672416290090323231',
    itemId: '7672416290090323231',
    adCode: '#jRJqXOxIAyaDbIjYF9Lde6IWMCFYU+sbgF/IdNT2999ucpFDpEUNNsXWHOc9RWw=',
    postedAt: '2026-08-10T14:53:43.000Z',
  },
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7673211804310408479',
    itemId: '7673211804310408479',
    adCode: '#+GaAwu7lvI3yCJQHhEFbZRwsFM7FfqUIqfLk27djaRL7nIzBew04SY/simxsDlM=',
    postedAt: '2026-08-12T18:20:43.000Z',
  },
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7674425365577747742',
    itemId: '7674425365577747742',
    adCode: '#nfB923RXLT7fBwvItEyCpOeuIbtUFeEMlLCNg04EoV/LdotlEpgYcsJgpR1Xabo=',
    postedAt: '2026-08-16T00:49:57.000Z',
  },
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7674679238242454815',
    itemId: '7674679238242454815',
    adCode: '#iBJ1/GBUHvr7MQKep3n6WnUAga98mI3ltGw926TzcFN/EkdHSrfC+ehB/9QxgnQ=',
    postedAt: '2026-08-16T17:15:06.000Z',
  },
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7674808681724136734',
    itemId: '7674808681724136734',
    adCode: '#Iw6i/adccXru5aFXYxPpznG/hgTjB9ykHbr9A0Nmba01iY2sx8Lt6OSTuJoKjUg=',
    postedAt: '2026-08-17T01:37:25.000Z',
  },
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7675104741206117663',
    itemId: '7675104741206117663',
    adCode: '#eMlKakRuBFVn5mKdpVkQHRmAYSi2cSA412XdSIy2jafTxWPjoCDjgebMIGhgXLw=',
    postedAt: '2026-08-17T20:46:17.000Z',
  },
  {
    handle: 'xxkissnoblissxx',
    url: 'https://www.tiktok.com/@xxkissnoblissxx/video/7675515108881141023',
    itemId: '7675515108881141023',
    adCode: '#W+XQCkzPPnDLz2PQnjUZgkjSu2X/ALUufqJRgAAZLV+GVC3eJlnP+wJsKlZYG1c=',
    postedAt: '2026-08-18T23:18:43.000Z',
  },
  // honestfindswithjen, 6 of a 15 video deal.
  // Her block carries no month at all. Rashid confirmed these six by hand on
  // 2026-08-19, pasting the links himself: "for jen honest the last 6 are his
  // videos for aug the month was not label". They are the same six the sheet
  // holds, checked id by id before they were added.
  {
    handle: 'honestfindswithjen',
    url: 'https://www.tiktok.com/@honestfindswithjen/video/7672857655769173262',
    itemId: '7672857655769173262',
    adCode: '#OfBiYTnj7iQ8J9EbmuASmApIsHOTu8wtUiD4b2o2MuX6LQlPAb5ztTJM6ELJ+A4=',
    postedAt: '2026-08-11T19:26:26.000Z',
  },
  {
    handle: 'honestfindswithjen',
    url: 'https://www.tiktok.com/@honestfindswithjen/video/7673256919716400398',
    itemId: '7673256919716400398',
    adCode: '#4Lrd44uIrM6rQikm6NVpe51soV9nMhv+OzcL2YPM+0qDvW/kt6Xka6mChY7PNsw=',
    postedAt: '2026-08-12T21:15:47.000Z',
  },
  {
    handle: 'honestfindswithjen',
    url: 'https://www.tiktok.com/@honestfindswithjen/video/7673259067829161229',
    itemId: '7673259067829161229',
    adCode: '#Va28mtR7ny1MFflhceL9z1l4iVPbL9yGovFs1crOuBuK4zaE8uSfTnW4nTrwtps=',
    postedAt: '2026-08-12T21:24:07.000Z',
  },
  {
    handle: 'honestfindswithjen',
    url: 'https://www.tiktok.com/@honestfindswithjen/video/7674654582596832526',
    itemId: '7674654582596832526',
    adCode: '#MhUUyhyy7bhf0adamzJSMuTKXV+2Wnebjf9qHTByDFxnF3uQ5WgzE1PZKoM/9ZY=',
    postedAt: '2026-08-16T15:39:26.000Z',
  },
  {
    handle: 'honestfindswithjen',
    url: 'https://www.tiktok.com/@honestfindswithjen/video/7674658144110333197',
    itemId: '7674658144110333197',
    adCode: '#tw6LETzUjPT/AIPBt5kJ/mmd0Xug0SLaBwssRHrYvVpL4xO9Mbqi5isvALimBQY=',
    postedAt: '2026-08-16T15:53:15.000Z',
  },
  {
    handle: 'honestfindswithjen',
    url: 'https://www.tiktok.com/@honestfindswithjen/video/7675381987284176142',
    itemId: '7675381987284176142',
    adCode: '#PnS3gikVdJnFDoQGP5HWDscEuWQoC8rmGmgA3fDtViGwo4NspwS9lX4ccItUQHU=',
    postedAt: '2026-08-18T14:42:08.000Z',
  },
];

const BRAND = 'Penetrex';

/* ------------------------------------------------------------------ setup -- */
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) {
  console.error(
    '\nSUPABASE_SERVICE_KEY is not set. Fetch it at run time from the CLI, never\n' +
      'from a file. See docs/OPERATIONS.md.\n'
  );
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// Creates and deletes data. Dev only, checked before the client exists.
assertDevProject(env.VITE_SUPABASE_URL, 'seed-august-content.mjs');

const db = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const CLEAN = process.argv.includes('--clean');
const SUBMITTED_ONLY = process.argv.includes('--submitted-only');

/* ------------------------------------------------------------- the people -- */
const handles = [...new Set(VIDEOS.map((v) => v.handle))];
const emails = handles.map((h) => `${h}@wurxmedia.com`);

const { data: brand, error: brandErr } = await db
  .from('brands')
  .select('id, name')
  .eq('name', BRAND)
  .maybeSingle();
if (brandErr) throw new Error(`could not read brands: ${brandErr.message}`);
if (!brand) {
  console.error(`\nNo brand called ${BRAND} exists.\n`);
  process.exit(1);
}

const { data: people, error: peopleErr } = await db
  .from('profiles')
  .select('id, email, display_name')
  .in('email', emails);
if (peopleErr) throw new Error(`could not read the creators: ${peopleErr.message}`);

const byHandle = new Map();
for (const p of people ?? []) byHandle.set(p.email.replace('@wurxmedia.com', ''), p);

const missingPeople = handles.filter((h) => !byHandle.has(h));
if (missingPeople.length) {
  console.error(
    `\nThese creators do not exist:\n  ${missingPeople.join('\n  ')}\n\n` +
      `Run scripts/seed/seed-creators.mjs first.\n`
  );
  process.exit(1);
}

/* -------------------------------------------------------- their Penetrex job -- */
/*
 * Content hangs off the JOB, not the offer: "ten videos for $1,600" is a
 * promise made to one creator on one request, so the count of what is still to
 * come is only answerable against that request.
 */
const { data: apps, error: appErr } = await db
  .from('offer_applications')
  .select('id, creator_id, offer_id, status')
  .eq('brand_id', brand.id)
  .eq('status', 'approved');
if (appErr) throw new Error(`could not read the approved jobs: ${appErr.message}`);

const appByCreator = new Map();
for (const a of apps ?? []) appByCreator.set(a.creator_id, a);

const withoutJob = handles.filter((h) => !appByCreator.has(byHandle.get(h).id));
if (withoutJob.length) {
  console.error(
    `\nThese creators have no approved ${BRAND} job to hang content off:\n  ` +
      withoutJob.join('\n  ') +
      `\n\nRun scripts/seed/seed-penetrex-offers.mjs first.\n`
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ clean -- */
if (CLEAN) {
  const urls = VIDEOS.map((v) => v.url);
  let removed = 0;
  for (let i = 0; i < urls.length; i += 50) {
    const { count, error } = await db
      .from('content_submissions')
      .delete({ count: 'exact' })
      .in('video_url', urls.slice(i, i + 50));
    if (error) throw new Error(`could not remove the videos: ${error.message}`);
    removed += count ?? 0;
  }
  console.log(`\n  ${removed} August videos removed.\n`);
  process.exit(0);
}

/* ------------------------------------------------------------- the actor -- */
const { data: staff, error: staffErr } = await db
  .from('profiles')
  .select('id, email, role')
  .in('role', ['admin', 'ops'])
  .eq('is_active', true)
  .order('created_at');
if (staffErr) throw new Error(`could not find an admin: ${staffErr.message}`);
const actor =
  (staff ?? []).find((s) => s.email === 'rashid@wurxmedia.com') ??
  (staff ?? []).find((s) => s.role === 'admin') ??
  (staff ?? [])[0];
if (!actor) {
  console.error('\nNo active admin exists, so nobody can review the content.\n');
  process.exit(1);
}

console.log(`\nAugust content for ${BRAND}\n${'='.repeat(70)}`);
console.log(`  ${VIDEOS.length} videos across ${handles.length} creators`);
console.log(`  reviewed by ${actor.email}`);
console.log(`  ${SUBMITTED_ONLY ? 'left waiting in the review queue' : 'approved'}\n`);

/* ------------------------------------------------------------------ load -- */
let added = 0;
let approved = 0;
let already = 0;
const problems = [];
const perCreator = new Map();

for (const video of VIDEOS) {
  const person = byHandle.get(video.handle);
  const job = appByCreator.get(person.id);

  try {
    const { data: made, error: subErr } = await db.rpc('submit_content', {
      p_actor_id: person.id,
      p_application_id: job.id,
      p_video_url: video.url,
      p_ad_code: video.adCode,
      // They gave us the code, which is the creator saying it is authorised at
      // their end. We cannot check that from here, so it is recorded as theirs.
      p_ad_authorized: true,
      p_thumbnail_url: null,
      p_video_title: null,
      p_video_author: `@${video.handle}`,
      // The join to the money. Without it the video is a link and nothing else.
      p_embed_id: video.itemId,
    });

    if (subErr) {
      // 23505: the same link twice against one job is a re-run, not an error.
      if (/duplicate key|23505/i.test(subErr.message)) {
        already += 1;
        continue;
      }
      throw new Error(subErr.message);
    }
    added += 1;
    const contentId = made?.id ?? made?.content?.id ?? made;

    if (!SUBMITTED_ONLY) {
      const { error: revErr } = await db.rpc('review_content', {
        p_actor_id: actor.id,
        p_content_id: contentId,
        p_status: 'approved',
        p_note: null,
      });
      if (revErr) throw new Error(`review: ${revErr.message}`);
      approved += 1;
    }

    /*
     * Filed on the day it went up, not the day this ran. The content screens
     * sort newest first, and 79 videos all stamped with this afternoon would
     * put August's work in an order nobody posted it in.
     */
    const { error: dateErr } = await db
      .from('content_submissions')
      .update({ created_at: video.postedAt, updated_at: video.postedAt })
      .eq('id', contentId);
    if (dateErr) throw new Error(`backdating: ${dateErr.message}`);

    perCreator.set(video.handle, (perCreator.get(video.handle) ?? 0) + 1);
  } catch (e) {
    problems.push(`${video.handle} ${video.itemId}: ${e.message}`);
    console.error(`  FAIL  ${video.handle.padEnd(20)} ${video.itemId}  ${e.message}`);
  }
}

/* ------------------------------------------------------------------ proof -- */
const { count: total } = await db
  .from('content_submissions')
  .select('*', { count: 'exact', head: true })
  .eq('brand_id', brand.id);
const { count: approvedRows } = await db
  .from('content_submissions')
  .select('*', { count: 'exact', head: true })
  .eq('brand_id', brand.id)
  .eq('status', 'approved');

/*
 * The point of the whole exercise: how much real money just attached itself.
 * Nothing was fetched from TikTok to make this true; the figures were already
 * in the database and had nothing to point at them.
 */
const itemIds = VIDEOS.map((v) => v.itemId);
let matched = new Set();
let cost = 0;
let revenue = 0;
let orders = 0;
for (let i = 0; i < itemIds.length; i += 80) {
  const { data, error } = await db
    .from('tiktok_video_daily')
    .select('item_id, cost, gross_revenue, orders')
    .in('item_id', itemIds.slice(i, i + 80));
  if (error) throw new Error(`could not read the ad figures: ${error.message}`);
  for (const r of data ?? []) {
    matched.add(r.item_id);
    cost += Number(r.cost);
    revenue += Number(r.gross_revenue);
    orders += r.orders;
  }
}

console.log(`\n${'='.repeat(70)}`);
console.log(`  ${added} added, ${approved} approved, ${already} already there`);
console.log(`  ${BRAND} now holds ${total} videos, ${approvedRows} of them approved`);
console.log('\n  per creator:');
for (const [h, n] of [...perCreator.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${h.padEnd(22)} ${String(n).padStart(3)}`);
}
console.log(
  `\n  ad figures already held for ${matched.size} of these ${itemIds.length} videos:` +
    `\n    $${cost.toFixed(2)} spent, $${revenue.toFixed(2)} GMV, ${orders} orders` +
    `\n  the other ${itemIds.length - matched.size} need a TikTok sync before they show anything.\n`
);

if (problems.length) {
  console.error(`  ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 15)) console.error(`    ${p}`);
  console.error('');
  process.exit(1);
}
