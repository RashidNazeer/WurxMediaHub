export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      applications: {
        Row: {
          created_at: string;
          id: string;
          niche: string;
          niche_other: string | null;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database['public']['Enums']['application_status'];
          tiktok_handle: string;
          tiktok_handle_verified: boolean;
          updated_at: string;
          user_id: string;
          video_links: string;
          worked_with_wurx: boolean;
        };
        Insert: {
          created_at?: string;
          id?: string;
          niche: string;
          niche_other?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['application_status'];
          tiktok_handle: string;
          tiktok_handle_verified?: boolean;
          updated_at?: string;
          user_id: string;
          video_links: string;
          worked_with_wurx: boolean;
        };
        Update: {
          created_at?: string;
          id?: string;
          niche?: string;
          niche_other?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['application_status'];
          tiktok_handle?: string;
          tiktok_handle_verified?: boolean;
          updated_at?: string;
          user_id?: string;
          video_links?: string;
          worked_with_wurx?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'applications_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'applications_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'applications_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'applications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'applications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'applications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_id: string | null;
          actor_role: Database['public']['Enums']['app_role'] | null;
          created_at: string;
          detail: Json;
          id: number;
          subject_id: string | null;
          subject_type: string;
          target_user_id: string | null;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_id?: string | null;
          actor_role?: Database['public']['Enums']['app_role'] | null;
          created_at?: string;
          detail?: Json;
          id?: never;
          subject_id?: string | null;
          subject_type: string;
          target_user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_id?: string | null;
          actor_role?: Database['public']['Enums']['app_role'] | null;
          created_at?: string;
          detail?: Json;
          id?: never;
          subject_id?: string | null;
          subject_type?: string;
          target_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'audit_log_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_log_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_log_target_user_id_fkey';
            columns: ['target_user_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'audit_log_target_user_id_fkey';
            columns: ['target_user_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_log_target_user_id_fkey';
            columns: ['target_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      brand_briefs: {
        Row: {
          brand_id: string;
          created_at: string;
          created_by: string | null;
          donts: string[];
          dos: string[];
          hooks: string[];
          id: string;
          is_active: boolean;
          title: string;
          updated_at: string;
          what_to_make: string | null;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          created_by?: string | null;
          donts?: string[];
          dos?: string[];
          hooks?: string[];
          id?: string;
          is_active?: boolean;
          title: string;
          updated_at?: string;
          what_to_make?: string | null;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          created_by?: string | null;
          donts?: string[];
          dos?: string[];
          hooks?: string[];
          id?: string;
          is_active?: boolean;
          title?: string;
          updated_at?: string;
          what_to_make?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'brand_briefs_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'brand_briefs_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'brand_briefs_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'brand_briefs_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      brand_commercials: {
        Row: {
          brand_id: string;
          budget_allocated: number | null;
          budget_used: number;
          budget_used_percent: number | null;
          client_name: string | null;
          created_at: string;
          currency: string;
          updated_at: string;
        };
        Insert: {
          brand_id: string;
          budget_allocated?: number | null;
          budget_used?: number;
          budget_used_percent?: number | null;
          client_name?: string | null;
          created_at?: string;
          currency?: string;
          updated_at?: string;
        };
        Update: {
          brand_id?: string;
          budget_allocated?: number | null;
          budget_used?: number;
          budget_used_percent?: number | null;
          client_name?: string | null;
          created_at?: string;
          currency?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'brand_commercials_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: true;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      brand_products: {
        Row: {
          badge_title: string | null;
          brand_id: string;
          commission_rate: number | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          external_product_id: string;
          id: string;
          image_url: string | null;
          is_active: boolean;
          name: string;
          price: number | null;
          updated_at: string;
        };
        Insert: {
          badge_title?: string | null;
          brand_id: string;
          commission_rate?: number | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          external_product_id: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          name: string;
          price?: number | null;
          updated_at?: string;
        };
        Update: {
          badge_title?: string | null;
          brand_id?: string;
          commission_rate?: number | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          external_product_id?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          name?: string;
          price?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'brand_products_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'brand_products_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'brand_products_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'brand_products_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      brands: {
        Row: {
          brand_color: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          founder_name: string | null;
          founder_note: string | null;
          founder_role: string | null;
          hero_url: string | null;
          id: string;
          is_active: boolean;
          logo_url: string | null;
          name: string;
          slug: string;
          store_id: string;
          tagline: string | null;
          theme: Json | null;
          updated_at: string;
        };
        Insert: {
          brand_color?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          founder_name?: string | null;
          founder_note?: string | null;
          founder_role?: string | null;
          hero_url?: string | null;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name: string;
          slug: string;
          store_id: string;
          tagline?: string | null;
          theme?: Json | null;
          updated_at?: string;
        };
        Update: {
          brand_color?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          founder_name?: string | null;
          founder_note?: string | null;
          founder_role?: string | null;
          hero_url?: string | null;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name?: string;
          slug?: string;
          store_id?: string;
          tagline?: string | null;
          theme?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'brands_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'brands_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'brands_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      collab_angle_batches: {
        Row: {
          attempts: number;
          brand: string;
          created_at: string;
          error: string | null;
          finished_at: string | null;
          id: string;
          last_phase: string | null;
          last_polled_at: string | null;
          lease_until: string | null;
          month: string;
          n_videos: number;
          provider_job: string | null;
          state: string;
          submitted_at: string | null;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          brand: string;
          created_at?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          last_phase?: string | null;
          last_polled_at?: string | null;
          lease_until?: string | null;
          month: string;
          n_videos?: number;
          provider_job?: string | null;
          state?: string;
          submitted_at?: string | null;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          brand?: string;
          created_at?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          last_phase?: string | null;
          last_polled_at?: string | null;
          lease_until?: string | null;
          month?: string;
          n_videos?: number;
          provider_job?: string | null;
          state?: string;
          submitted_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      collab_angle_videos: {
        Row: {
          angle: string | null;
          attempts: number;
          batch_id: string | null;
          brand: string;
          brief_label: string | null;
          created_at: string;
          creator: string | null;
          filed_at: string | null;
          id: string;
          last_error: string | null;
          month: string;
          status: string;
          updated_at: string;
          video_id: string;
          video_url: string;
        };
        Insert: {
          angle?: string | null;
          attempts?: number;
          batch_id?: string | null;
          brand: string;
          brief_label?: string | null;
          created_at?: string;
          creator?: string | null;
          filed_at?: string | null;
          id?: string;
          last_error?: string | null;
          month: string;
          status?: string;
          updated_at?: string;
          video_id: string;
          video_url: string;
        };
        Update: {
          angle?: string | null;
          attempts?: number;
          batch_id?: string | null;
          brand?: string;
          brief_label?: string | null;
          created_at?: string;
          creator?: string | null;
          filed_at?: string | null;
          id?: string;
          last_error?: string | null;
          month?: string;
          status?: string;
          updated_at?: string;
          video_id?: string;
          video_url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'collab_angle_videos_batch_id_fkey';
            columns: ['batch_id'];
            isOneToOne: false;
            referencedRelation: 'collab_angle_batches';
            referencedColumns: ['id'];
          },
        ];
      };
      collab_brand_briefs: {
        Row: {
          aliases: string[];
          angles: string[];
          brand: string;
          brief_url: string;
          created_at: string;
          id: string;
          is_active: boolean;
          position: number;
          product: string;
          updated_at: string;
        };
        Insert: {
          aliases?: string[];
          angles?: string[];
          brand: string;
          brief_url: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          position?: number;
          product?: string;
          updated_at?: string;
        };
        Update: {
          aliases?: string[];
          angles?: string[];
          brand?: string;
          brief_url?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          position?: number;
          product?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      collab_brand_photos: {
        Row: {
          brand: string;
          bytes: number | null;
          handle: string | null;
          path: string;
          source: string;
          updated_at: string;
        };
        Insert: {
          brand: string;
          bytes?: number | null;
          handle?: string | null;
          path: string;
          source?: string;
          updated_at?: string;
        };
        Update: {
          brand?: string;
          bytes?: number | null;
          handle?: string | null;
          path?: string;
          source?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      collab_product_images: {
        Row: {
          checked_at: string;
          image_url: string | null;
          product_id: string;
          source: string;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          checked_at?: string;
          image_url?: string | null;
          product_id: string;
          source?: string;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          checked_at?: string;
          image_url?: string | null;
          product_id?: string;
          source?: string;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      collab_share_euka_cache: {
        Row: {
          fetched_at: string;
          handles: Json;
          store_id: string;
          store_name: string | null;
        };
        Insert: {
          fetched_at?: string;
          handles?: Json;
          store_id: string;
          store_name?: string | null;
        };
        Update: {
          fetched_at?: string;
          handles?: Json;
          store_id?: string;
          store_name?: string | null;
        };
        Relationships: [];
      };
      collab_share_links: {
        Row: {
          brands: string[];
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          label: string;
          last_viewed_at: string | null;
          months: string[];
          revoked_at: string | null;
          show_creators: boolean;
          show_kpis: boolean;
          show_top_videos: boolean;
          show_videos: boolean;
          token: string | null;
          token_hash: string;
          token_hint: string;
          view_count: number;
        };
        Insert: {
          brands: string[];
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          id?: string;
          label: string;
          last_viewed_at?: string | null;
          months?: string[];
          revoked_at?: string | null;
          show_creators?: boolean;
          show_kpis?: boolean;
          show_top_videos?: boolean;
          show_videos?: boolean;
          token?: string | null;
          token_hash: string;
          token_hint: string;
          view_count?: number;
        };
        Update: {
          brands?: string[];
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          label?: string;
          last_viewed_at?: string | null;
          months?: string[];
          revoked_at?: string | null;
          show_creators?: boolean;
          show_kpis?: boolean;
          show_top_videos?: boolean;
          show_videos?: boolean;
          token?: string | null;
          token_hash?: string;
          token_hint?: string;
          view_count?: number;
        };
        Relationships: [];
      };
      collab_share_views: {
        Row: {
          id: number;
          ip_hash: string | null;
          link_id: string;
          user_agent: string | null;
          viewed_at: string;
        };
        Insert: {
          id?: number;
          ip_hash?: string | null;
          link_id: string;
          user_agent?: string | null;
          viewed_at?: string;
        };
        Update: {
          id?: number;
          ip_hash?: string | null;
          link_id?: string;
          user_agent?: string | null;
          viewed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'collab_share_views_link_id_fkey';
            columns: ['link_id'];
            isOneToOne: false;
            referencedRelation: 'collab_share_links';
            referencedColumns: ['id'];
          },
        ];
      };
      content_submissions: {
        Row: {
          ad_authorized: boolean;
          ad_code: string;
          application_id: string;
          brand_id: string;
          created_at: string;
          creator_handle: string | null;
          creator_id: string;
          creator_name: string | null;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          embed_id: string | null;
          id: string;
          offer_id: string;
          status: Database['public']['Enums']['content_status'];
          thumbnail_url: string | null;
          updated_at: string;
          video_author: string | null;
          video_title: string | null;
          video_url: string;
        };
        Insert: {
          ad_authorized?: boolean;
          ad_code: string;
          application_id: string;
          brand_id: string;
          created_at?: string;
          creator_handle?: string | null;
          creator_id: string;
          creator_name?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          embed_id?: string | null;
          id?: string;
          offer_id: string;
          status?: Database['public']['Enums']['content_status'];
          thumbnail_url?: string | null;
          updated_at?: string;
          video_author?: string | null;
          video_title?: string | null;
          video_url: string;
        };
        Update: {
          ad_authorized?: boolean;
          ad_code?: string;
          application_id?: string;
          brand_id?: string;
          created_at?: string;
          creator_handle?: string | null;
          creator_id?: string;
          creator_name?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          embed_id?: string | null;
          id?: string;
          offer_id?: string;
          status?: Database['public']['Enums']['content_status'];
          thumbnail_url?: string | null;
          updated_at?: string;
          video_author?: string | null;
          video_title?: string | null;
          video_url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'content_submissions_application_id_fkey';
            columns: ['application_id'];
            isOneToOne: false;
            referencedRelation: 'job_progress';
            referencedColumns: ['application_id'];
          },
          {
            foreignKeyName: 'content_submissions_application_id_fkey';
            columns: ['application_id'];
            isOneToOne: false;
            referencedRelation: 'offer_applications';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'content_submissions_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'content_submissions_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'content_submissions_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'content_submissions_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'content_submissions_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'content_submissions_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'content_submissions_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'content_submissions_offer_id_fkey';
            columns: ['offer_id'];
            isOneToOne: false;
            referencedRelation: 'offers';
            referencedColumns: ['id'];
          },
        ];
      };
      contest_awards: {
        Row: {
          awarded_amount: number;
          awarded_by: string | null;
          awarded_currency: string;
          contest_id: string;
          created_at: string;
          creator_id: string;
          entry_id: string;
          id: string;
          message: string | null;
          paid_at: string | null;
          paid_by: string | null;
          reached_value: number | null;
          term_id: string;
        };
        Insert: {
          awarded_amount: number;
          awarded_by?: string | null;
          awarded_currency: string;
          contest_id: string;
          created_at?: string;
          creator_id: string;
          entry_id: string;
          id?: string;
          message?: string | null;
          paid_at?: string | null;
          paid_by?: string | null;
          reached_value?: number | null;
          term_id: string;
        };
        Update: {
          awarded_amount?: number;
          awarded_by?: string | null;
          awarded_currency?: string;
          contest_id?: string;
          created_at?: string;
          creator_id?: string;
          entry_id?: string;
          id?: string;
          message?: string | null;
          paid_at?: string | null;
          paid_by?: string | null;
          reached_value?: number | null;
          term_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_awards_awarded_by_fkey';
            columns: ['awarded_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_awards_awarded_by_fkey';
            columns: ['awarded_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_awards_awarded_by_fkey';
            columns: ['awarded_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_awards_contest_id_fkey';
            columns: ['contest_id'];
            isOneToOne: false;
            referencedRelation: 'contests';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_awards_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_awards_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_awards_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_awards_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entries';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_awards_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entry_confirmed_totals';
            referencedColumns: ['entry_id'];
          },
          {
            foreignKeyName: 'contest_awards_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entry_progress';
            referencedColumns: ['entry_id'];
          },
          {
            foreignKeyName: 'contest_awards_paid_by_fkey';
            columns: ['paid_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_awards_paid_by_fkey';
            columns: ['paid_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_awards_paid_by_fkey';
            columns: ['paid_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_awards_term_id_fkey';
            columns: ['term_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entry_terms';
            referencedColumns: ['id'];
          },
        ];
      };
      contest_commercials: {
        Row: {
          contest_id: string;
          created_at: string;
          internal_note: string | null;
          total_budget: number | null;
          updated_at: string;
        };
        Insert: {
          contest_id: string;
          created_at?: string;
          internal_note?: string | null;
          total_budget?: number | null;
          updated_at?: string;
        };
        Update: {
          contest_id?: string;
          created_at?: string;
          internal_note?: string | null;
          total_budget?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_commercials_contest_id_fkey';
            columns: ['contest_id'];
            isOneToOne: true;
            referencedRelation: 'contests';
            referencedColumns: ['id'];
          },
        ];
      };
      contest_deliverables: {
        Row: {
          contest_id: string;
          created_at: string;
          detail: string | null;
          id: string;
          is_active: boolean;
          reward_amount: number;
          sort_order: number;
          target_value: number;
          title: string;
          type: Database['public']['Enums']['contest_deliverable_type'];
          updated_at: string;
        };
        Insert: {
          contest_id: string;
          created_at?: string;
          detail?: string | null;
          id?: string;
          is_active?: boolean;
          reward_amount: number;
          sort_order?: number;
          target_value: number;
          title: string;
          type: Database['public']['Enums']['contest_deliverable_type'];
          updated_at?: string;
        };
        Update: {
          contest_id?: string;
          created_at?: string;
          detail?: string | null;
          id?: string;
          is_active?: boolean;
          reward_amount?: number;
          sort_order?: number;
          target_value?: number;
          title?: string;
          type?: Database['public']['Enums']['contest_deliverable_type'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_deliverables_contest_id_fkey';
            columns: ['contest_id'];
            isOneToOne: false;
            referencedRelation: 'contests';
            referencedColumns: ['id'];
          },
        ];
      };
      contest_entries: {
        Row: {
          auto_approved: boolean;
          brand_id: string;
          committed_amount: number | null;
          committed_video_count: number | null;
          contest_id: string;
          created_at: string;
          creator_email: string | null;
          creator_handle: string | null;
          creator_id: string;
          creator_name: string | null;
          currency: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          id: string;
          note: string | null;
          status: Database['public']['Enums']['contest_entry_status'];
          updated_at: string;
        };
        Insert: {
          auto_approved?: boolean;
          brand_id: string;
          committed_amount?: number | null;
          committed_video_count?: number | null;
          contest_id: string;
          created_at?: string;
          creator_email?: string | null;
          creator_handle?: string | null;
          creator_id: string;
          creator_name?: string | null;
          currency?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          id?: string;
          note?: string | null;
          status?: Database['public']['Enums']['contest_entry_status'];
          updated_at?: string;
        };
        Update: {
          auto_approved?: boolean;
          brand_id?: string;
          committed_amount?: number | null;
          committed_video_count?: number | null;
          contest_id?: string;
          created_at?: string;
          creator_email?: string | null;
          creator_handle?: string | null;
          creator_id?: string;
          creator_name?: string | null;
          currency?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          id?: string;
          note?: string | null;
          status?: Database['public']['Enums']['contest_entry_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_entries_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entries_contest_id_fkey';
            columns: ['contest_id'];
            isOneToOne: false;
            referencedRelation: 'contests';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entries_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_entries_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entries_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entries_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_entries_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entries_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      contest_entry_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          creator_id: string;
          entry_id: string;
          id: number;
          kind: string;
          note: string | null;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          creator_id: string;
          entry_id: string;
          id?: never;
          kind: string;
          note?: string | null;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          creator_id?: string;
          entry_id?: string;
          id?: never;
          kind?: string;
          note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_entry_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_entry_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entry_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entry_events_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_entry_events_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entry_events_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entry_events_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entries';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entry_events_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entry_confirmed_totals';
            referencedColumns: ['entry_id'];
          },
          {
            foreignKeyName: 'contest_entry_events_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entry_progress';
            referencedColumns: ['entry_id'];
          },
        ];
      };
      contest_entry_targets: {
        Row: {
          created_at: string;
          creator_id: string;
          entry_id: string;
          target: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          creator_id: string;
          entry_id: string;
          target: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          creator_id?: string;
          entry_id?: string;
          target?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_entry_targets_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_entry_targets_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entry_targets_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entry_targets_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: true;
            referencedRelation: 'contest_entries';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entry_targets_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: true;
            referencedRelation: 'contest_entry_confirmed_totals';
            referencedColumns: ['entry_id'];
          },
          {
            foreignKeyName: 'contest_entry_targets_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: true;
            referencedRelation: 'contest_entry_progress';
            referencedColumns: ['entry_id'];
          },
        ];
      };
      contest_entry_terms: {
        Row: {
          created_at: string;
          currency: string;
          deliverable_id: string | null;
          detail: string | null;
          entry_id: string;
          id: string;
          reward_amount: number;
          target_value: number;
          title: string;
          type: Database['public']['Enums']['contest_deliverable_type'];
        };
        Insert: {
          created_at?: string;
          currency: string;
          deliverable_id?: string | null;
          detail?: string | null;
          entry_id: string;
          id?: string;
          reward_amount: number;
          target_value: number;
          title: string;
          type: Database['public']['Enums']['contest_deliverable_type'];
        };
        Update: {
          created_at?: string;
          currency?: string;
          deliverable_id?: string | null;
          detail?: string | null;
          entry_id?: string;
          id?: string;
          reward_amount?: number;
          target_value?: number;
          title?: string;
          type?: Database['public']['Enums']['contest_deliverable_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'contest_entry_terms_deliverable_id_fkey';
            columns: ['deliverable_id'];
            isOneToOne: false;
            referencedRelation: 'contest_deliverables';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entry_terms_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entries';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entry_terms_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entry_confirmed_totals';
            referencedColumns: ['entry_id'];
          },
          {
            foreignKeyName: 'contest_entry_terms_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entry_progress';
            referencedColumns: ['entry_id'];
          },
        ];
      };
      contest_exclusions: {
        Row: {
          attempts: number;
          contest_id: string;
          created_at: string;
          created_by: string | null;
          email: string | null;
          handle: string | null;
          id: string;
          last_attempt_at: string | null;
          reason: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          attempts?: number;
          contest_id: string;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          handle?: string | null;
          id?: string;
          last_attempt_at?: string | null;
          reason?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          attempts?: number;
          contest_id?: string;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          handle?: string | null;
          id?: string;
          last_attempt_at?: string | null;
          reason?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_exclusions_contest_id_fkey';
            columns: ['contest_id'];
            isOneToOne: false;
            referencedRelation: 'contests';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_exclusions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_exclusions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_exclusions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_exclusions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_exclusions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_exclusions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      contest_products: {
        Row: {
          brand_id: string;
          contest_id: string;
          created_at: string;
          external_product_id: string;
          product_id: string;
          product_name: string;
        };
        Insert: {
          brand_id: string;
          contest_id: string;
          created_at?: string;
          external_product_id: string;
          product_id: string;
          product_name: string;
        };
        Update: {
          brand_id?: string;
          contest_id?: string;
          created_at?: string;
          external_product_id?: string;
          product_id?: string;
          product_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_products_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_products_contest_id_brand_id_fkey';
            columns: ['contest_id', 'brand_id'];
            isOneToOne: false;
            referencedRelation: 'contests';
            referencedColumns: ['id', 'brand_id'];
          },
          {
            foreignKeyName: 'contest_products_contest_id_fkey';
            columns: ['contest_id'];
            isOneToOne: false;
            referencedRelation: 'contests';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_products_product_id_brand_id_fkey';
            columns: ['product_id', 'brand_id'];
            isOneToOne: false;
            referencedRelation: 'brand_products';
            referencedColumns: ['id', 'brand_id'];
          },
          {
            foreignKeyName: 'contest_products_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'brand_products';
            referencedColumns: ['id'];
          },
        ];
      };
      contest_progress_updates: {
        Row: {
          confirmed_at: string | null;
          confirmed_by: string | null;
          created_at: string;
          creator_id: string;
          entry_id: string;
          gmv: number;
          id: string;
          staff_message: string | null;
          status: Database['public']['Enums']['contest_progress_status'];
          updated_at: string;
          video_count: number;
        };
        Insert: {
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          creator_id: string;
          entry_id: string;
          gmv?: number;
          id?: string;
          staff_message?: string | null;
          status?: Database['public']['Enums']['contest_progress_status'];
          updated_at?: string;
          video_count?: number;
        };
        Update: {
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          creator_id?: string;
          entry_id?: string;
          gmv?: number;
          id?: string;
          staff_message?: string | null;
          status?: Database['public']['Enums']['contest_progress_status'];
          updated_at?: string;
          video_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_progress_updates_confirmed_by_fkey';
            columns: ['confirmed_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_progress_updates_confirmed_by_fkey';
            columns: ['confirmed_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_progress_updates_confirmed_by_fkey';
            columns: ['confirmed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_progress_updates_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_progress_updates_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_progress_updates_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_progress_updates_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entries';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_progress_updates_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entry_confirmed_totals';
            referencedColumns: ['entry_id'];
          },
          {
            foreignKeyName: 'contest_progress_updates_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entry_progress';
            referencedColumns: ['entry_id'];
          },
        ];
      };
      contest_submissions: {
        Row: {
          ad_authorized: boolean;
          ad_code: string;
          brand_id: string;
          contest_id: string;
          created_at: string;
          creator_handle: string | null;
          creator_id: string;
          creator_name: string | null;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          embed_id: string | null;
          entry_id: string;
          id: string;
          progress_update_id: string | null;
          status: Database['public']['Enums']['content_status'];
          thumbnail_url: string | null;
          updated_at: string;
          video_author: string | null;
          video_title: string | null;
          video_url: string;
        };
        Insert: {
          ad_authorized?: boolean;
          ad_code: string;
          brand_id: string;
          contest_id: string;
          created_at?: string;
          creator_handle?: string | null;
          creator_id: string;
          creator_name?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          embed_id?: string | null;
          entry_id: string;
          id?: string;
          progress_update_id?: string | null;
          status?: Database['public']['Enums']['content_status'];
          thumbnail_url?: string | null;
          updated_at?: string;
          video_author?: string | null;
          video_title?: string | null;
          video_url: string;
        };
        Update: {
          ad_authorized?: boolean;
          ad_code?: string;
          brand_id?: string;
          contest_id?: string;
          created_at?: string;
          creator_handle?: string | null;
          creator_id?: string;
          creator_name?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          embed_id?: string | null;
          entry_id?: string;
          id?: string;
          progress_update_id?: string | null;
          status?: Database['public']['Enums']['content_status'];
          thumbnail_url?: string | null;
          updated_at?: string;
          video_author?: string | null;
          video_title?: string | null;
          video_url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_submissions_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_submissions_contest_id_fkey';
            columns: ['contest_id'];
            isOneToOne: false;
            referencedRelation: 'contests';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_submissions_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_submissions_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_submissions_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_submissions_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_submissions_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_submissions_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_submissions_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entries';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_submissions_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entry_confirmed_totals';
            referencedColumns: ['entry_id'];
          },
          {
            foreignKeyName: 'contest_submissions_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'contest_entry_progress';
            referencedColumns: ['entry_id'];
          },
          {
            foreignKeyName: 'contest_submissions_progress_update_id_fkey';
            columns: ['progress_update_id'];
            isOneToOne: false;
            referencedRelation: 'contest_progress_updates';
            referencedColumns: ['id'];
          },
        ];
      };
      contests: {
        Row: {
          banner_url: string | null;
          brand_id: string;
          brief_url: string | null;
          cancel_message: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          card_image_url: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          description: string | null;
          expires_at: string;
          expires_at_timezone: string;
          id: string;
          name: string;
          needs_admin_approval: boolean;
          opens_at: string;
          perks: string | null;
          settled_at: string | null;
          settled_by: string | null;
          status: Database['public']['Enums']['contest_status'];
          updated_at: string;
        };
        Insert: {
          banner_url?: string | null;
          brand_id: string;
          brief_url?: string | null;
          cancel_message?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          card_image_url?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          description?: string | null;
          expires_at: string;
          expires_at_timezone?: string;
          id?: string;
          name: string;
          needs_admin_approval?: boolean;
          opens_at?: string;
          perks?: string | null;
          settled_at?: string | null;
          settled_by?: string | null;
          status?: Database['public']['Enums']['contest_status'];
          updated_at?: string;
        };
        Update: {
          banner_url?: string | null;
          brand_id?: string;
          brief_url?: string | null;
          cancel_message?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          card_image_url?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          description?: string | null;
          expires_at?: string;
          expires_at_timezone?: string;
          id?: string;
          name?: string;
          needs_admin_approval?: boolean;
          opens_at?: string;
          perks?: string | null;
          settled_at?: string | null;
          settled_by?: string | null;
          status?: Database['public']['Enums']['contest_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contests_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contests_cancelled_by_fkey';
            columns: ['cancelled_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contests_cancelled_by_fkey';
            columns: ['cancelled_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contests_cancelled_by_fkey';
            columns: ['cancelled_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contests_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contests_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contests_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contests_settled_by_fkey';
            columns: ['settled_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contests_settled_by_fkey';
            columns: ['settled_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contests_settled_by_fkey';
            columns: ['settled_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      creator_avatars: {
        Row: {
          bytes: number | null;
          error: string | null;
          fetched_at: string;
          handle: string | null;
          path: string | null;
          profile_id: string;
          source: string;
        };
        Insert: {
          bytes?: number | null;
          error?: string | null;
          fetched_at?: string;
          handle?: string | null;
          path?: string | null;
          profile_id: string;
          source?: string;
        };
        Update: {
          bytes?: number | null;
          error?: string | null;
          fetched_at?: string;
          handle?: string | null;
          path?: string | null;
          profile_id?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'creator_avatars_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: true;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'creator_avatars_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: true;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'creator_avatars_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      creator_tiktok_connections: {
        Row: {
          app_generation: string;
          avatar_url: string | null;
          connected_at: string;
          creator_id: string;
          display_name: string | null;
          follower_count: number | null;
          is_verified: boolean | null;
          last_error: string | null;
          last_synced_at: string | null;
          likes_count: number | null;
          open_id: string;
          profile_deep_link: string | null;
          profile_synced_at: string | null;
          revoked_at: string | null;
          scope: string;
          union_id: string | null;
          username: string | null;
          video_count: number | null;
        };
        Insert: {
          app_generation?: string;
          avatar_url?: string | null;
          connected_at?: string;
          creator_id: string;
          display_name?: string | null;
          follower_count?: number | null;
          is_verified?: boolean | null;
          last_error?: string | null;
          last_synced_at?: string | null;
          likes_count?: number | null;
          open_id: string;
          profile_deep_link?: string | null;
          profile_synced_at?: string | null;
          revoked_at?: string | null;
          scope?: string;
          union_id?: string | null;
          username?: string | null;
          video_count?: number | null;
        };
        Update: {
          app_generation?: string;
          avatar_url?: string | null;
          connected_at?: string;
          creator_id?: string;
          display_name?: string | null;
          follower_count?: number | null;
          is_verified?: boolean | null;
          last_error?: string | null;
          last_synced_at?: string | null;
          likes_count?: number | null;
          open_id?: string;
          profile_deep_link?: string | null;
          profile_synced_at?: string | null;
          revoked_at?: string | null;
          scope?: string;
          union_id?: string | null;
          username?: string | null;
          video_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'creator_tiktok_connections_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: true;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'creator_tiktok_connections_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: true;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'creator_tiktok_connections_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      creator_tiktok_oauth_states: {
        Row: {
          created_at: string;
          creator_id: string;
          expires_at: string;
          state: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          creator_id: string;
          expires_at: string;
          state: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          creator_id?: string;
          expires_at?: string;
          state?: string;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'creator_tiktok_oauth_states_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'creator_tiktok_oauth_states_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'creator_tiktok_oauth_states_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      creator_tiktok_tokens: {
        Row: {
          access_expires_at: string | null;
          access_token: string;
          creator_id: string;
          refresh_expires_at: string | null;
          refresh_token: string | null;
          updated_at: string;
        };
        Insert: {
          access_expires_at?: string | null;
          access_token: string;
          creator_id: string;
          refresh_expires_at?: string | null;
          refresh_token?: string | null;
          updated_at?: string;
        };
        Update: {
          access_expires_at?: string | null;
          access_token?: string;
          creator_id?: string;
          refresh_expires_at?: string | null;
          refresh_token?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'creator_tiktok_tokens_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: true;
            referencedRelation: 'creator_tiktok_connections';
            referencedColumns: ['creator_id'];
          },
        ];
      };
      creator_tiktok_videos: {
        Row: {
          comment_count: number | null;
          cover_image_url: string | null;
          creator_id: string;
          duration: number | null;
          fetched_at: string;
          like_count: number | null;
          posted_at: string | null;
          share_count: number | null;
          share_url: string | null;
          title: string | null;
          video_id: string;
          view_count: number | null;
        };
        Insert: {
          comment_count?: number | null;
          cover_image_url?: string | null;
          creator_id: string;
          duration?: number | null;
          fetched_at?: string;
          like_count?: number | null;
          posted_at?: string | null;
          share_count?: number | null;
          share_url?: string | null;
          title?: string | null;
          video_id: string;
          view_count?: number | null;
        };
        Update: {
          comment_count?: number | null;
          cover_image_url?: string | null;
          creator_id?: string;
          duration?: number | null;
          fetched_at?: string;
          like_count?: number | null;
          posted_at?: string | null;
          share_count?: number | null;
          share_url?: string | null;
          title?: string | null;
          video_id?: string;
          view_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'creator_tiktok_videos_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'creator_tiktok_videos_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'creator_tiktok_videos_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      euka_ad_sync_stores: {
        Row: {
          advertisers: number | null;
          campaigns_listed: number | null;
          campaigns_reported: number | null;
          checked_at: string;
          connected: boolean | null;
          last_error: string | null;
          store_id: string;
          store_name: string | null;
        };
        Insert: {
          advertisers?: number | null;
          campaigns_listed?: number | null;
          campaigns_reported?: number | null;
          checked_at?: string;
          connected?: boolean | null;
          last_error?: string | null;
          store_id: string;
          store_name?: string | null;
        };
        Update: {
          advertisers?: number | null;
          campaigns_listed?: number | null;
          campaigns_reported?: number | null;
          checked_at?: string;
          connected?: boolean | null;
          last_error?: string | null;
          store_id?: string;
          store_name?: string | null;
        };
        Relationships: [];
      };
      euka_ad_sync_units: {
        Row: {
          advertiser_id: string;
          advertiser_name: string | null;
          attempts: number;
          campaign_id: string;
          campaign_name: string | null;
          cost: number | null;
          due_at: string;
          last_error: string | null;
          month: string;
          row_count: number | null;
          status: string;
          store_id: string;
          store_name: string | null;
          synced_at: string | null;
          updated_at: string;
        };
        Insert: {
          advertiser_id: string;
          advertiser_name?: string | null;
          attempts?: number;
          campaign_id: string;
          campaign_name?: string | null;
          cost?: number | null;
          due_at?: string;
          last_error?: string | null;
          month: string;
          row_count?: number | null;
          status?: string;
          store_id: string;
          store_name?: string | null;
          synced_at?: string | null;
          updated_at?: string;
        };
        Update: {
          advertiser_id?: string;
          advertiser_name?: string | null;
          attempts?: number;
          campaign_id?: string;
          campaign_name?: string | null;
          cost?: number | null;
          due_at?: string;
          last_error?: string | null;
          month?: string;
          row_count?: number | null;
          status?: string;
          store_id?: string;
          store_name?: string | null;
          synced_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      euka_ad_video_month: {
        Row: {
          advertiser_id: string;
          campaign_id: string;
          cost: number;
          currency: string | null;
          gross_revenue: number;
          item_id: string;
          month: string;
          orders: number;
          source: string;
          store_id: string;
          synced_at: string;
        };
        Insert: {
          advertiser_id: string;
          campaign_id: string;
          cost?: number;
          currency?: string | null;
          gross_revenue?: number;
          item_id: string;
          month: string;
          orders?: number;
          source?: string;
          store_id: string;
          synced_at?: string;
        };
        Update: {
          advertiser_id?: string;
          campaign_id?: string;
          cost?: number;
          currency?: string | null;
          gross_revenue?: number;
          item_id?: string;
          month?: string;
          orders?: number;
          source?: string;
          store_id?: string;
          synced_at?: string;
        };
        Relationships: [];
      };
      euka_creator_categories: {
        Row: {
          categories: string[];
          checked_at: string;
          found: boolean;
          handle: string;
          last_error: string | null;
          written: string | null;
        };
        Insert: {
          categories?: string[];
          checked_at?: string;
          found?: boolean;
          handle: string;
          last_error?: string | null;
          written?: string | null;
        };
        Update: {
          categories?: string[];
          checked_at?: string;
          found?: boolean;
          handle?: string;
          last_error?: string | null;
          written?: string | null;
        };
        Relationships: [];
      };
      euka_creator_followers: {
        Row: {
          checked_at: string;
          creator_id: string | null;
          followers: number | null;
          found: boolean;
          handle: string;
          last_error: string | null;
        };
        Insert: {
          checked_at?: string;
          creator_id?: string | null;
          followers?: number | null;
          found?: boolean;
          handle: string;
          last_error?: string | null;
        };
        Update: {
          checked_at?: string;
          creator_id?: string | null;
          followers?: number | null;
          found?: boolean;
          handle?: string;
          last_error?: string | null;
        };
        Relationships: [];
      };
      euka_spark_codes: {
        Row: {
          expired: boolean | null;
          expires_at: string | null;
          item_id: string;
          posted_date: string | null;
          spark_code: string;
          store_id: string;
          synced_at: string;
        };
        Insert: {
          expired?: boolean | null;
          expires_at?: string | null;
          item_id: string;
          posted_date?: string | null;
          spark_code: string;
          store_id: string;
          synced_at?: string;
        };
        Update: {
          expired?: boolean | null;
          expires_at?: string | null;
          item_id?: string;
          posted_date?: string | null;
          spark_code?: string;
          store_id?: string;
          synced_at?: string;
        };
        Relationships: [];
      };
      euka_spark_sync_days: {
        Row: {
          attempts: number;
          capped: boolean | null;
          day: string;
          due_at: string;
          last_error: string | null;
          row_count: number | null;
          status: string;
          store_id: string;
          synced_at: string | null;
        };
        Insert: {
          attempts?: number;
          capped?: boolean | null;
          day: string;
          due_at?: string;
          last_error?: string | null;
          row_count?: number | null;
          status?: string;
          store_id: string;
          synced_at?: string | null;
        };
        Update: {
          attempts?: number;
          capped?: boolean | null;
          day?: string;
          due_at?: string;
          last_error?: string | null;
          row_count?: number | null;
          status?: string;
          store_id?: string;
          synced_at?: string | null;
        };
        Relationships: [];
      };
      offer_applications: {
        Row: {
          brand_id: string;
          committed_amount: number | null;
          committed_video_count: number | null;
          created_at: string;
          creator_email: string | null;
          creator_handle: string | null;
          creator_id: string;
          creator_name: string | null;
          currency: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          id: string;
          note: string | null;
          offer_id: string;
          stage: Database['public']['Enums']['offer_stage'] | null;
          stage_updated_at: string | null;
          status: Database['public']['Enums']['offer_application_status'];
          updated_at: string;
        };
        Insert: {
          brand_id: string;
          committed_amount?: number | null;
          committed_video_count?: number | null;
          created_at?: string;
          creator_email?: string | null;
          creator_handle?: string | null;
          creator_id: string;
          creator_name?: string | null;
          currency?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          id?: string;
          note?: string | null;
          offer_id: string;
          stage?: Database['public']['Enums']['offer_stage'] | null;
          stage_updated_at?: string | null;
          status?: Database['public']['Enums']['offer_application_status'];
          updated_at?: string;
        };
        Update: {
          brand_id?: string;
          committed_amount?: number | null;
          committed_video_count?: number | null;
          created_at?: string;
          creator_email?: string | null;
          creator_handle?: string | null;
          creator_id?: string;
          creator_name?: string | null;
          currency?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          id?: string;
          note?: string | null;
          offer_id?: string;
          stage?: Database['public']['Enums']['offer_stage'] | null;
          stage_updated_at?: string | null;
          status?: Database['public']['Enums']['offer_application_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'offer_applications_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_applications_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'offer_applications_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_applications_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_applications_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'offer_applications_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_applications_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_applications_offer_id_fkey';
            columns: ['offer_id'];
            isOneToOne: false;
            referencedRelation: 'offers';
            referencedColumns: ['id'];
          },
        ];
      };
      offer_audience: {
        Row: {
          added_at: string;
          added_by: string | null;
          creator_id: string;
          mode: string;
          offer_id: string;
        };
        Insert: {
          added_at?: string;
          added_by?: string | null;
          creator_id: string;
          mode: string;
          offer_id: string;
        };
        Update: {
          added_at?: string;
          added_by?: string | null;
          creator_id?: string;
          mode?: string;
          offer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'offer_audience_added_by_fkey';
            columns: ['added_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'offer_audience_added_by_fkey';
            columns: ['added_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_audience_added_by_fkey';
            columns: ['added_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_audience_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'offer_audience_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_audience_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_audience_offer_id_fkey';
            columns: ['offer_id'];
            isOneToOne: false;
            referencedRelation: 'offers';
            referencedColumns: ['id'];
          },
        ];
      };
      offer_stage_events: {
        Row: {
          actor_id: string | null;
          application_id: string;
          created_at: string;
          creator_id: string;
          from_stage: Database['public']['Enums']['offer_stage'] | null;
          id: number;
          note: string | null;
          to_stage: Database['public']['Enums']['offer_stage'];
        };
        Insert: {
          actor_id?: string | null;
          application_id: string;
          created_at?: string;
          creator_id: string;
          from_stage?: Database['public']['Enums']['offer_stage'] | null;
          id?: never;
          note?: string | null;
          to_stage: Database['public']['Enums']['offer_stage'];
        };
        Update: {
          actor_id?: string | null;
          application_id?: string;
          created_at?: string;
          creator_id?: string;
          from_stage?: Database['public']['Enums']['offer_stage'] | null;
          id?: never;
          note?: string | null;
          to_stage?: Database['public']['Enums']['offer_stage'];
        };
        Relationships: [
          {
            foreignKeyName: 'offer_stage_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'offer_stage_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_stage_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_stage_events_application_id_fkey';
            columns: ['application_id'];
            isOneToOne: false;
            referencedRelation: 'job_progress';
            referencedColumns: ['application_id'];
          },
          {
            foreignKeyName: 'offer_stage_events_application_id_fkey';
            columns: ['application_id'];
            isOneToOne: false;
            referencedRelation: 'offer_applications';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_stage_events_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'offer_stage_events_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_stage_events_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      offers: {
        Row: {
          badge_title: string | null;
          brand_id: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          description: string | null;
          id: string;
          kind: Database['public']['Enums']['offer_kind'];
          needs_application: boolean;
          reward_amount: number | null;
          status: Database['public']['Enums']['offer_status'];
          title: string;
          updated_at: string;
          video_count: number | null;
        };
        Insert: {
          badge_title?: string | null;
          brand_id: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          description?: string | null;
          id?: string;
          kind?: Database['public']['Enums']['offer_kind'];
          needs_application?: boolean;
          reward_amount?: number | null;
          status?: Database['public']['Enums']['offer_status'];
          title: string;
          updated_at?: string;
          video_count?: number | null;
        };
        Update: {
          badge_title?: string | null;
          brand_id?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          description?: string | null;
          id?: string;
          kind?: Database['public']['Enums']['offer_kind'];
          needs_application?: boolean;
          reward_amount?: number | null;
          status?: Database['public']['Enums']['offer_status'];
          title?: string;
          updated_at?: string;
          video_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'offers_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offers_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'offers_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offers_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          approval_celebrated_at: string | null;
          created_at: string;
          display_name: string | null;
          email: string;
          id: string;
          is_active: boolean;
          role: Database['public']['Enums']['app_role'];
          tier: Database['public']['Enums']['creator_tier'] | null;
          updated_at: string;
          welcomed_at: string | null;
        };
        Insert: {
          approval_celebrated_at?: string | null;
          created_at?: string;
          display_name?: string | null;
          email: string;
          id: string;
          is_active?: boolean;
          role?: Database['public']['Enums']['app_role'];
          tier?: Database['public']['Enums']['creator_tier'] | null;
          updated_at?: string;
          welcomed_at?: string | null;
        };
        Update: {
          approval_celebrated_at?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string;
          id?: string;
          is_active?: boolean;
          role?: Database['public']['Enums']['app_role'];
          tier?: Database['public']['Enums']['creator_tier'] | null;
          updated_at?: string;
          welcomed_at?: string | null;
        };
        Relationships: [];
      };
      reacher_sync_runs: {
        Row: {
          campaigns_seen: number;
          creators_matched: number;
          id: number;
          ms: number | null;
          note: string | null;
          ok: boolean;
          ran_at: string;
          shop_id: number;
          shop_name: string | null;
          spend_rows: number;
          videos_filed: number;
          videos_seen: number;
        };
        Insert: {
          campaigns_seen?: number;
          creators_matched?: number;
          id?: number;
          ms?: number | null;
          note?: string | null;
          ok?: boolean;
          ran_at?: string;
          shop_id: number;
          shop_name?: string | null;
          spend_rows?: number;
          videos_filed?: number;
          videos_seen?: number;
        };
        Update: {
          campaigns_seen?: number;
          creators_matched?: number;
          id?: number;
          ms?: number | null;
          note?: string | null;
          ok?: boolean;
          ran_at?: string;
          shop_id?: number;
          shop_name?: string | null;
          spend_rows?: number;
          videos_filed?: number;
          videos_seen?: number;
        };
        Relationships: [];
      };
      tiktok_ad_accounts: {
        Row: {
          advertiser_id: string;
          connection_id: string;
          currency: string | null;
          first_seen_at: string;
          last_seen_at: string;
          name: string | null;
          timezone: string | null;
        };
        Insert: {
          advertiser_id: string;
          connection_id: string;
          currency?: string | null;
          first_seen_at?: string;
          last_seen_at?: string;
          name?: string | null;
          timezone?: string | null;
        };
        Update: {
          advertiser_id?: string;
          connection_id?: string;
          currency?: string | null;
          first_seen_at?: string;
          last_seen_at?: string;
          name?: string | null;
          timezone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tiktok_ad_accounts_connection_id_fkey';
            columns: ['connection_id'];
            isOneToOne: false;
            referencedRelation: 'tiktok_connection_health';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_ad_accounts_connection_id_fkey';
            columns: ['connection_id'];
            isOneToOne: false;
            referencedRelation: 'tiktok_connections';
            referencedColumns: ['id'];
          },
        ];
      };
      tiktok_connections: {
        Row: {
          access_token: string;
          connected_at: string;
          connected_by: string | null;
          granted_advertiser_ids: string[];
          id: string;
          last_error: string | null;
          last_verified_at: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          scope: string | null;
        };
        Insert: {
          access_token: string;
          connected_at?: string;
          connected_by?: string | null;
          granted_advertiser_ids?: string[];
          id?: string;
          last_error?: string | null;
          last_verified_at?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          scope?: string | null;
        };
        Update: {
          access_token?: string;
          connected_at?: string;
          connected_by?: string | null;
          granted_advertiser_ids?: string[];
          id?: string;
          last_error?: string | null;
          last_verified_at?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          scope?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tiktok_connections_connected_by_fkey';
            columns: ['connected_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'tiktok_connections_connected_by_fkey';
            columns: ['connected_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_connections_connected_by_fkey';
            columns: ['connected_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_connections_revoked_by_fkey';
            columns: ['revoked_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'tiktok_connections_revoked_by_fkey';
            columns: ['revoked_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_connections_revoked_by_fkey';
            columns: ['revoked_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      tiktok_identities: {
        Row: {
          app_generation: string;
          application_id: string | null;
          claimed_at: string;
          handle: string | null;
          id: string;
          open_id: string;
          profile_id: string | null;
          release_reason: string | null;
          released_at: string | null;
          released_by: string | null;
          source: string;
          union_id: string | null;
        };
        Insert: {
          app_generation?: string;
          application_id?: string | null;
          claimed_at?: string;
          handle?: string | null;
          id?: string;
          open_id: string;
          profile_id?: string | null;
          release_reason?: string | null;
          released_at?: string | null;
          released_by?: string | null;
          source?: string;
          union_id?: string | null;
        };
        Update: {
          app_generation?: string;
          application_id?: string | null;
          claimed_at?: string;
          handle?: string | null;
          id?: string;
          open_id?: string;
          profile_id?: string | null;
          release_reason?: string | null;
          released_at?: string | null;
          released_by?: string | null;
          source?: string;
          union_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tiktok_identities_application_id_fkey';
            columns: ['application_id'];
            isOneToOne: false;
            referencedRelation: 'applications';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_identities_application_id_fkey';
            columns: ['application_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['application_id'];
          },
          {
            foreignKeyName: 'tiktok_identities_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'tiktok_identities_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_identities_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_identities_released_by_fkey';
            columns: ['released_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'tiktok_identities_released_by_fkey';
            columns: ['released_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_identities_released_by_fkey';
            columns: ['released_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      tiktok_oauth_states: {
        Row: {
          created_at: string;
          expires_at: string;
          started_by: string | null;
          state: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          started_by?: string | null;
          state: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          started_by?: string | null;
          state?: string;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tiktok_oauth_states_started_by_fkey';
            columns: ['started_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'tiktok_oauth_states_started_by_fkey';
            columns: ['started_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_oauth_states_started_by_fkey';
            columns: ['started_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      tiktok_signup_pending: {
        Row: {
          access_expires_at: string | null;
          access_token: string | null;
          avatar_url: string | null;
          browser_secret_hash: string;
          claimed_at: string | null;
          claimed_by: string | null;
          created_at: string;
          display_name: string | null;
          expires_at: string;
          handle: string | null;
          id: string;
          open_id: string;
          refresh_expires_at: string | null;
          refresh_token: string | null;
          scope: string;
          started_by: string | null;
          ticket_hash: string;
          union_id: string | null;
        };
        Insert: {
          access_expires_at?: string | null;
          access_token?: string | null;
          avatar_url?: string | null;
          browser_secret_hash: string;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          display_name?: string | null;
          expires_at: string;
          handle?: string | null;
          id?: string;
          open_id: string;
          refresh_expires_at?: string | null;
          refresh_token?: string | null;
          scope?: string;
          started_by?: string | null;
          ticket_hash: string;
          union_id?: string | null;
        };
        Update: {
          access_expires_at?: string | null;
          access_token?: string | null;
          avatar_url?: string | null;
          browser_secret_hash?: string;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          display_name?: string | null;
          expires_at?: string;
          handle?: string | null;
          id?: string;
          open_id?: string;
          refresh_expires_at?: string | null;
          refresh_token?: string | null;
          scope?: string;
          started_by?: string | null;
          ticket_hash?: string;
          union_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tiktok_signup_pending_claimed_by_fkey';
            columns: ['claimed_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'tiktok_signup_pending_claimed_by_fkey';
            columns: ['claimed_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_signup_pending_claimed_by_fkey';
            columns: ['claimed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_signup_pending_started_by_fkey';
            columns: ['started_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'tiktok_signup_pending_started_by_fkey';
            columns: ['started_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_signup_pending_started_by_fkey';
            columns: ['started_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      tiktok_signup_states: {
        Row: {
          browser_secret_hash: string;
          created_at: string;
          expires_at: string;
          started_by: string | null;
          state: string;
          used_at: string | null;
        };
        Insert: {
          browser_secret_hash: string;
          created_at?: string;
          expires_at: string;
          started_by?: string | null;
          state: string;
          used_at?: string | null;
        };
        Update: {
          browser_secret_hash?: string;
          created_at?: string;
          expires_at?: string;
          started_by?: string | null;
          state?: string;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tiktok_signup_states_started_by_fkey';
            columns: ['started_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'tiktok_signup_states_started_by_fkey';
            columns: ['started_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_signup_states_started_by_fkey';
            columns: ['started_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      tiktok_stores: {
        Row: {
          advertiser_id: string;
          bc_name: string | null;
          brand_id: string | null;
          first_seen_at: string;
          is_gmv_max_available: boolean | null;
          last_seen_at: string;
          mapped_at: string | null;
          mapped_by: string | null;
          name: string | null;
          store_authorized_bc_id: string | null;
          store_id: string;
          store_status: string | null;
          thumbnail_url: string | null;
        };
        Insert: {
          advertiser_id: string;
          bc_name?: string | null;
          brand_id?: string | null;
          first_seen_at?: string;
          is_gmv_max_available?: boolean | null;
          last_seen_at?: string;
          mapped_at?: string | null;
          mapped_by?: string | null;
          name?: string | null;
          store_authorized_bc_id?: string | null;
          store_id: string;
          store_status?: string | null;
          thumbnail_url?: string | null;
        };
        Update: {
          advertiser_id?: string;
          bc_name?: string | null;
          brand_id?: string | null;
          first_seen_at?: string;
          is_gmv_max_available?: boolean | null;
          last_seen_at?: string;
          mapped_at?: string | null;
          mapped_by?: string | null;
          name?: string | null;
          store_authorized_bc_id?: string | null;
          store_id?: string;
          store_status?: string | null;
          thumbnail_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tiktok_stores_advertiser_id_fkey';
            columns: ['advertiser_id'];
            isOneToOne: false;
            referencedRelation: 'tiktok_account_map';
            referencedColumns: ['advertiser_id'];
          },
          {
            foreignKeyName: 'tiktok_stores_advertiser_id_fkey';
            columns: ['advertiser_id'];
            isOneToOne: false;
            referencedRelation: 'tiktok_ad_accounts';
            referencedColumns: ['advertiser_id'];
          },
          {
            foreignKeyName: 'tiktok_stores_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_stores_mapped_by_fkey';
            columns: ['mapped_by'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'tiktok_stores_mapped_by_fkey';
            columns: ['mapped_by'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiktok_stores_mapped_by_fkey';
            columns: ['mapped_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      tiktok_sync_runs: {
        Row: {
          advertiser_id: string | null;
          error: string | null;
          finished_at: string | null;
          id: string;
          rows_written: number | null;
          started_at: string;
          stat_date: string | null;
          store_id: string | null;
          trigger: string;
          videos_asked: number | null;
          videos_hash: string | null;
        };
        Insert: {
          advertiser_id?: string | null;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          rows_written?: number | null;
          started_at?: string;
          stat_date?: string | null;
          store_id?: string | null;
          trigger?: string;
          videos_asked?: number | null;
          videos_hash?: string | null;
        };
        Update: {
          advertiser_id?: string | null;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          rows_written?: number | null;
          started_at?: string;
          stat_date?: string | null;
          store_id?: string | null;
          trigger?: string;
          videos_asked?: number | null;
          videos_hash?: string | null;
        };
        Relationships: [];
      };
      tiktok_video_daily: {
        Row: {
          advertiser_id: string;
          brand_id: string | null;
          cost: number;
          currency: string | null;
          fetched_at: string;
          gross_revenue: number;
          item_id: string;
          orders: number;
          stat_date: string;
          store_id: string | null;
        };
        Insert: {
          advertiser_id: string;
          brand_id?: string | null;
          cost?: number;
          currency?: string | null;
          fetched_at?: string;
          gross_revenue?: number;
          item_id: string;
          orders?: number;
          stat_date: string;
          store_id?: string | null;
        };
        Update: {
          advertiser_id?: string;
          brand_id?: string | null;
          cost?: number;
          currency?: string | null;
          fetched_at?: string;
          gross_revenue?: number;
          item_id?: string;
          orders?: number;
          stat_date?: string;
          store_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tiktok_video_daily_advertiser_id_fkey';
            columns: ['advertiser_id'];
            isOneToOne: false;
            referencedRelation: 'tiktok_account_map';
            referencedColumns: ['advertiser_id'];
          },
          {
            foreignKeyName: 'tiktok_video_daily_advertiser_id_fkey';
            columns: ['advertiser_id'];
            isOneToOne: false;
            referencedRelation: 'tiktok_ad_accounts';
            referencedColumns: ['advertiser_id'];
          },
          {
            foreignKeyName: 'tiktok_video_daily_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      brand_content_totals: {
        Row: {
          brand_id: string | null;
          creators: number | null;
          jobs: number | null;
          last_posted_at: string | null;
          status: Database['public']['Enums']['content_status'] | null;
          videos: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'content_submissions_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      brand_contest_totals: {
        Row: {
          awarded: number | null;
          brand_id: string | null;
          committed: number | null;
          contests: number | null;
          currency: string | null;
          entries_approved: number | null;
          entries_pending: number | null;
          owed: number | null;
          paid: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_entries_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      brand_creator_roster: {
        Row: {
          brand_id: string | null;
          committed: number | null;
          committed_currency: string | null;
          creator_email: string | null;
          creator_handle: string | null;
          creator_id: string | null;
          creator_name: string | null;
          currency_count: number | null;
          due: number | null;
          first_asked_at: string | null;
          jobs: number | null;
          jobs_approved: number | null;
          jobs_due: number | null;
          jobs_paid: number | null;
          jobs_pending: number | null;
          jobs_rejected: number | null;
          jobs_working: number | null;
          last_decided_at: string | null;
          last_moved_at: string | null;
          last_posted_at: string | null;
          paid: number | null;
          videos_approved: number | null;
          videos_needs_another_take: number | null;
          videos_posted: number | null;
          videos_promised: number | null;
          videos_waiting: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'offer_applications_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_applications_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'offer_applications_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_applications_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      brand_stage_totals: {
        Row: {
          brand_id: string | null;
          committed: number | null;
          currency: string | null;
          jobs: number | null;
          stage: Database['public']['Enums']['offer_stage'] | null;
          videos_promised: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'offer_applications_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      contest_award_totals: {
        Row: {
          awarded: number | null;
          awards: number | null;
          awards_owed: number | null;
          awards_paid: number | null;
          brand_id: string | null;
          contest_id: string | null;
          creators: number | null;
          currency: string | null;
          owed: number | null;
          owed_since: string | null;
          paid: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_awards_contest_id_fkey';
            columns: ['contest_id'];
            isOneToOne: false;
            referencedRelation: 'contests';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contests_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      contest_entry_confirmed_totals: {
        Row: {
          brand_id: string | null;
          claims_waiting: number | null;
          confirmed_at: string | null;
          confirmed_gmv: number | null;
          confirmed_video_count: number | null;
          contest_id: string | null;
          creator_id: string | null;
          entry_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_entries_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entries_contest_id_fkey';
            columns: ['contest_id'];
            isOneToOne: false;
            referencedRelation: 'contests';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entries_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_entries_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entries_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      contest_entry_progress: {
        Row: {
          approved: number | null;
          brand_id: string | null;
          contest_id: string | null;
          creator_id: string | null;
          entry_id: string | null;
          needs_another_take: number | null;
          posted: number | null;
          required: number | null;
          still_to_film: number | null;
          waiting: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_entries_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entries_contest_id_fkey';
            columns: ['contest_id'];
            isOneToOne: false;
            referencedRelation: 'contests';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entries_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'contest_entries_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entries_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      contest_totals: {
        Row: {
          brand_id: string | null;
          committed: number | null;
          contest_id: string | null;
          currency: string | null;
          entries_approved: number | null;
          entries_pending: number | null;
          entries_rejected: number | null;
          entries_withdrawn: number | null;
          last_entered_at: string | null;
          videos_promised: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'contest_entries_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contest_entries_contest_id_fkey';
            columns: ['contest_id'];
            isOneToOne: false;
            referencedRelation: 'contests';
            referencedColumns: ['id'];
          },
        ];
      };
      creator_avatar_queue: {
        Row: {
          display_name: string | null;
          error: string | null;
          fetched_at: string | null;
          path: string | null;
          profile_id: string | null;
          role: Database['public']['Enums']['app_role'] | null;
          tiktok_handle: string | null;
        };
        Relationships: [];
      };
      creator_directory: {
        Row: {
          application_id: string | null;
          application_status: Database['public']['Enums']['application_status'] | null;
          created_at: string | null;
          display_name: string | null;
          email: string | null;
          id: string | null;
          is_active: boolean | null;
          niche: string | null;
          reviewed_at: string | null;
          role: Database['public']['Enums']['app_role'] | null;
          tier: Database['public']['Enums']['creator_tier'] | null;
          tiktok_handle: string | null;
        };
        Relationships: [];
      };
      creator_videos: {
        Row: {
          ad_authorized: boolean | null;
          brand_id: string | null;
          created_at: string | null;
          creator_id: string | null;
          embed_id: string | null;
          source: string | null;
          status: Database['public']['Enums']['content_status'] | null;
          submission_id: string | null;
          thumbnail_url: string | null;
          video_title: string | null;
          video_url: string | null;
        };
        Relationships: [];
      };
      job_progress: {
        Row: {
          application_id: string | null;
          approved: number | null;
          brand_id: string | null;
          creator_id: string | null;
          needs_another_take: number | null;
          offer_id: string | null;
          posted: number | null;
          required: number | null;
          waiting: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'offer_applications_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_applications_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_avatar_queue';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'offer_applications_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'creator_directory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_applications_creator_id_fkey';
            columns: ['creator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offer_applications_offer_id_fkey';
            columns: ['offer_id'];
            isOneToOne: false;
            referencedRelation: 'offers';
            referencedColumns: ['id'];
          },
        ];
      };
      tiktok_account_map: {
        Row: {
          advertiser_id: string | null;
          advertiser_name: string | null;
          bc_name: string | null;
          brand_id: string | null;
          brand_name: string | null;
          currency: string | null;
          is_gmv_max_available: boolean | null;
          last_seen_at: string | null;
          mapped_at: string | null;
          store_authorized_bc_id: string | null;
          store_id: string | null;
          store_name: string | null;
          store_status: string | null;
          timezone: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tiktok_stores_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      tiktok_connection_health: {
        Row: {
          connected_at: string | null;
          connected_by_email: string | null;
          connected_by_name: string | null;
          granted_advertiser_count: number | null;
          id: string | null;
          last_error: string | null;
          last_verified_at: string | null;
          revoked_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      ads_totals_for_videos: {
        Args: { p_from?: string; p_item_ids: string[]; p_to?: string };
        Returns: {
          cost: number;
          currency: string;
          first_day: string;
          gross_revenue: number;
          item_id: string;
          last_day: string;
          mixed_currency: boolean;
          orders: number;
        }[];
      };
      apply_for_contest: {
        Args: { p_actor_id: string; p_contest_id: string; p_note?: string };
        Returns: Json;
      };
      apply_for_offer: {
        Args: { p_actor_id: string; p_note?: string; p_offer_id: string };
        Returns: Json;
      };
      assert_active_creator: {
        Args: { p_actor_id: string };
        Returns: {
          approval_celebrated_at: string | null;
          created_at: string;
          display_name: string | null;
          email: string;
          id: string;
          is_active: boolean;
          role: Database['public']['Enums']['app_role'];
          tier: Database['public']['Enums']['creator_tier'] | null;
          updated_at: string;
          welcomed_at: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'profiles';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      assert_active_staff: {
        Args: { p_actor_id: string };
        Returns: {
          approval_celebrated_at: string | null;
          created_at: string;
          display_name: string | null;
          email: string;
          id: string;
          is_active: boolean;
          role: Database['public']['Enums']['app_role'];
          tier: Database['public']['Enums']['creator_tier'] | null;
          updated_at: string;
          welcomed_at: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'profiles';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      assert_contest_within_budget: {
        Args: { p_budget: number; p_contest_id: string; p_currency: string };
        Returns: undefined;
      };
      brand_theme_ok: { Args: { p: Json }; Returns: boolean };
      can_see_offer: {
        Args: {
          p_kind: Database['public']['Enums']['offer_kind'];
          p_offer_id: string;
        };
        Returns: boolean;
      };
      cancel_contest: {
        Args: { p_actor_id: string; p_contest_id: string; p_message?: string };
        Returns: Json;
      };
      claim_tiktok_signup: {
        Args: {
          p_browser_secret_hash: string;
          p_profile: string;
          p_ticket_hash: string;
        };
        Returns: {
          out_already: boolean;
          out_handle: string;
          out_open_id: string;
        }[];
      };
      collab_angles_run_cycle: { Args: never; Returns: number };
      collab_angles_set_sync_secret: {
        Args: { p_secret: string };
        Returns: undefined;
      };
      collab_angles_set_sync_url: {
        Args: { p_url: string };
        Returns: undefined;
      };
      collab_brand_creator_videos: {
        Args: { p_brand: string };
        Returns: {
          hiring_date: string;
          name: string;
          video_codes: Json;
        }[];
      };
      collab_share_create: {
        Args: {
          p_brands: string[];
          p_days?: number;
          p_label: string;
          p_months?: string[];
          p_show_creators?: boolean;
          p_show_kpis?: boolean;
          p_show_top_videos?: boolean;
          p_show_videos?: boolean;
        };
        Returns: {
          expires_at: string;
          id: string;
          token: string;
        }[];
      };
      collab_share_list: {
        Args: never;
        Returns: {
          brands: string[];
          created_at: string;
          expires_at: string;
          id: string;
          is_live: boolean;
          label: string;
          last_viewed_at: string;
          months: string[];
          revoked_at: string;
          show_creators: boolean;
          show_kpis: boolean;
          show_top_videos: boolean;
          show_videos: boolean;
          token: string;
          token_hint: string;
          view_count: number;
        }[];
      };
      collab_share_opens: {
        Args: { p_id: string; p_limit?: number };
        Returns: {
          user_agent: string;
          viewed_at: string;
          visitor: string;
        }[];
      };
      collab_share_replace: {
        Args: { p_id: string };
        Returns: {
          expires_at: string;
          id: string;
          token: string;
        }[];
      };
      collab_share_revoke: { Args: { p_id: string }; Returns: string };
      contest_excludes: {
        Args: { p_contest_id: string; p_user_id: string };
        Returns: boolean;
      };
      contest_is_open: { Args: { p_contest_id: string }; Returns: boolean };
      creator_brand_performance: {
        Args: { p_from: string; p_to: string };
        Returns: {
          brand_id: string;
          brand_name: string;
          currency: string;
          gmv: number;
          orders: number;
          roi: number;
          spend: number;
          videos: number;
        }[];
      };
      creator_daily_performance: {
        Args: {
          p_brand_id?: string;
          p_from: string;
          p_source?: string;
          p_to: string;
        };
        Returns: {
          cost: number;
          currency: string;
          gross_revenue: number;
          orders: number;
          stat_date: string;
          videos: number;
        }[];
      };
      creator_leaderboard: {
        Args: {
          p_brand_id?: string;
          p_from: string;
          p_limit?: number;
          p_offset?: number;
          p_search?: string;
          p_to: string;
        };
        Returns: {
          avatar_path: string;
          creator_id: string;
          currency: string;
          display_name: string;
          gmv: number;
          is_me: boolean;
          orders: number;
          rank: number;
          spend: number;
          total_creators: number;
          videos: number;
        }[];
      };
      creator_performance_window: {
        Args: { p_brand_id?: string };
        Returns: {
          earliest: string;
          latest: string;
          videos: number;
        }[];
      };
      creator_tiktok_sweep_states: { Args: never; Returns: undefined };
      creator_video_performance: {
        Args: {
          p_brand_id?: string;
          p_from: string;
          p_source?: string;
          p_to: string;
        };
        Returns: {
          ads_ever: boolean;
          brand_id: string;
          brand_name: string;
          cost: number;
          cost_per_order: number;
          currency: string;
          days_with_data: number;
          gross_revenue: number;
          item_id: string;
          last_active_date: string;
          lifetime_cost: number;
          lifetime_revenue: number;
          orders: number;
          roi: number;
          source: string;
          submission_id: string;
          submitted_at: string;
          thumbnail_url: string;
          video_title: string;
          video_url: string;
        }[];
      };
      custom_access_token_hook: { Args: { event: Json }; Returns: Json };
      delete_brand_brief: {
        Args: { p_actor_id: string; p_brief_id: string };
        Returns: Json;
      };
      delete_content: {
        Args: { p_actor_id: string; p_content_id: string };
        Returns: Json;
      };
      delete_contest: {
        Args: { p_actor_id: string; p_contest_id: string };
        Returns: Json;
      };
      delete_offer: {
        Args: { p_actor_id: string; p_offer_id: string };
        Returns: Json;
      };
      delete_product: {
        Args: { p_actor_id: string; p_product_id: string };
        Returns: Json;
      };
      euka_ad_claim_units: {
        Args: { p_limit: number };
        Returns: {
          advertiser_id: string;
          advertiser_name: string | null;
          attempts: number;
          campaign_id: string;
          campaign_name: string | null;
          cost: number | null;
          due_at: string;
          last_error: string | null;
          month: string;
          row_count: number | null;
          status: string;
          store_id: string;
          store_name: string | null;
          synced_at: string | null;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'euka_ad_sync_units';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      euka_ad_replace_unit: {
        Args: {
          p_advertiser_id: string;
          p_campaign_id: string;
          p_month: string;
          p_rows: Json;
          p_store_id: string;
        };
        Returns: number;
      };
      euka_ad_totals_for_videos: {
        Args: { p_from?: string; p_item_ids: string[]; p_to?: string };
        Returns: {
          cost: number;
          currency: string;
          gross_revenue: number;
          item_id: string;
          mixed_currency: boolean;
          orders: number;
        }[];
      };
      euka_ads_run_cycle: { Args: never; Returns: number };
      euka_ads_set_sync_secret: {
        Args: { p_secret: string };
        Returns: undefined;
      };
      euka_ads_set_sync_url: { Args: { p_url: string }; Returns: undefined };
      euka_followers_for_handles: {
        Args: { p_handles: string[] };
        Returns: {
          followers: number;
          handle: string;
        }[];
      };
      euka_spark_claim_days: {
        Args: { p_limit: number };
        Returns: {
          attempts: number;
          capped: boolean | null;
          day: string;
          due_at: string;
          last_error: string | null;
          row_count: number | null;
          status: string;
          store_id: string;
          synced_at: string | null;
        }[];
        SetofOptions: {
          from: '*';
          to: 'euka_spark_sync_days';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      euka_spark_codes_for_videos: {
        Args: { p_item_ids: string[] };
        Returns: {
          expired: boolean;
          item_id: string;
          spark_code: string;
        }[];
      };
      is_approved_creator: { Args: never; Returns: boolean };
      is_collabs_viewer: { Args: never; Returns: boolean };
      is_service_role: { Args: never; Returns: boolean };
      is_staff: { Args: never; Returns: boolean };
      job_is_filmed: { Args: { p_application_id: string }; Returns: boolean };
      jwt_role: {
        Args: never;
        Returns: Database['public']['Enums']['app_role'];
      };
      my_contest_standing: {
        Args: { p_contest_id: string };
        Returns: {
          confirmed_gmv: number;
          confirmed_video_count: number;
          entrants: number;
          gmv_place: number;
          video_place: number;
        }[];
      };
      my_leaderboard_standing: {
        Args: { p_brand_id?: string; p_from: string; p_to: string };
        Returns: {
          currency: string;
          gmv: number;
          orders: number;
          rank: number;
          spend: number;
          top_percent: number;
          total_creators: number;
          videos: number;
        }[];
      };
      offer_is_for: {
        Args: {
          p_creator_id: string;
          p_kind: Database['public']['Enums']['offer_kind'];
          p_offer_id: string;
        };
        Returns: boolean;
      };
      pay_contest_awards: {
        Args: {
          p_actor_id: string;
          p_allow_suspended?: boolean;
          p_award_ids: string[];
          p_message?: string;
        };
        Returns: Json;
      };
      pin_contest_exclusions: {
        Args: { p_email: string; p_handle: string; p_user_id: string };
        Returns: undefined;
      };
      reacher_run_cycle: { Args: never; Returns: number };
      reacher_set_sync_secret: {
        Args: { p_secret: string };
        Returns: undefined;
      };
      reacher_set_sync_url: { Args: { p_url: string }; Returns: undefined };
      record_contest_exclusion_attempt: {
        Args: { p_contest_id: string; p_user_id: string };
        Returns: Json;
      };
      refresh_content_preview: {
        Args: {
          p_actor_id: string;
          p_content_id: string;
          p_embed_id?: string;
          p_thumbnail_url: string;
          p_video_author?: string;
          p_video_title?: string;
        };
        Returns: Json;
      };
      release_tiktok_identity: {
        Args: { p_identity_id: string; p_reason: string };
        Returns: {
          app_generation: string;
          application_id: string | null;
          claimed_at: string;
          handle: string | null;
          id: string;
          open_id: string;
          profile_id: string | null;
          release_reason: string | null;
          released_at: string | null;
          released_by: string | null;
          source: string;
          union_id: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'tiktok_identities';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      remove_contest_exclusion: {
        Args: { p_actor_id: string; p_exclusion_id: string };
        Returns: Json;
      };
      retire_contest_deliverable: {
        Args: { p_actor_id: string; p_deliverable_id: string };
        Returns: Json;
      };
      review_application: {
        Args: {
          p_actor_id: string;
          p_application_id: string;
          p_decision: Database['public']['Enums']['application_status'];
          p_note?: string;
          p_tier?: Database['public']['Enums']['creator_tier'];
        };
        Returns: Json;
      };
      review_content: {
        Args: {
          p_actor_id: string;
          p_content_id: string;
          p_note?: string;
          p_status: Database['public']['Enums']['content_status'];
        };
        Returns: Json;
      };
      review_contest_content: {
        Args: {
          p_actor_id: string;
          p_content_id: string;
          p_note?: string;
          p_status: Database['public']['Enums']['content_status'];
        };
        Returns: Json;
      };
      review_contest_entry: {
        Args: {
          p_actor_id: string;
          p_block?: boolean;
          p_block_reason?: string;
          p_decision: Database['public']['Enums']['contest_entry_status'];
          p_entry_id: string;
          p_note?: string;
        };
        Returns: Json;
      };
      review_contest_progress: {
        Args: {
          p_actor_id: string;
          p_message?: string;
          p_status: Database['public']['Enums']['contest_progress_status'];
          p_update_id: string;
        };
        Returns: Json;
      };
      review_offer_application: {
        Args: {
          p_actor_id: string;
          p_application_id: string;
          p_decision: Database['public']['Enums']['offer_application_status'];
          p_note?: string;
          p_stage?: Database['public']['Enums']['offer_stage'];
        };
        Returns: Json;
      };
      save_brand: {
        Args: {
          p_actor_id: string;
          p_brand_id?: string;
          p_budget?: number;
          p_client_name?: string;
          p_currency?: string;
          p_is_active?: boolean;
          p_name: string;
          p_store_id: string;
        };
        Returns: Json;
      };
      save_brand_about: {
        Args: {
          p_actor_id: string;
          p_brand_color?: string;
          p_brand_id: string;
          p_description?: string;
          p_founder_name?: string;
          p_founder_note?: string;
          p_founder_role?: string;
          p_hero_url?: string;
          p_logo_url?: string;
          p_tagline?: string;
          p_theme?: Json;
        };
        Returns: Json;
      };
      save_brand_brief: {
        Args: {
          p_actor_id: string;
          p_brand_id: string;
          p_brief_id?: string;
          p_donts?: string[];
          p_dos?: string[];
          p_hooks?: string[];
          p_is_active?: boolean;
          p_title: string;
          p_what_to_make?: string;
        };
        Returns: Json;
      };
      save_contest: {
        Args: {
          p_actor_id: string;
          p_banner_url?: string;
          p_brand_id: string;
          p_brief_url?: string;
          p_card_image_url?: string;
          p_contest_id?: string;
          p_currency?: string;
          p_description?: string;
          p_expires_at: string;
          p_expires_at_timezone: string;
          p_name: string;
          p_needs_admin_approval?: boolean;
          p_opens_at?: string;
          p_perks?: string;
          p_status?: Database['public']['Enums']['contest_status'];
        };
        Returns: Json;
      };
      save_contest_commercials: {
        Args: {
          p_actor_id: string;
          p_contest_id: string;
          p_internal_note?: string;
          p_total_budget?: number;
        };
        Returns: Json;
      };
      save_contest_deliverable: {
        Args: {
          p_actor_id: string;
          p_contest_id: string;
          p_deliverable_id?: string;
          p_detail?: string;
          p_is_active?: boolean;
          p_reward_amount: number;
          p_sort_order?: number;
          p_target_value: number;
          p_title: string;
          p_type: Database['public']['Enums']['contest_deliverable_type'];
        };
        Returns: Json;
      };
      save_contest_exclusion: {
        Args: {
          p_actor_id: string;
          p_contest_id: string;
          p_email?: string;
          p_handle?: string;
          p_reason?: string;
          p_user_id?: string;
        };
        Returns: Json;
      };
      save_offer: {
        Args: {
          p_actor_id: string;
          p_audience?: string[];
          p_badge_title?: string;
          p_brand_id: string;
          p_currency?: string;
          p_description?: string;
          p_kind?: Database['public']['Enums']['offer_kind'];
          p_needs_application?: boolean;
          p_offer_id?: string;
          p_reward_amount: number;
          p_status?: Database['public']['Enums']['offer_status'];
          p_title: string;
          p_video_count: number;
        };
        Returns: Json;
      };
      save_product: {
        Args: {
          p_actor_id: string;
          p_badge_title?: string;
          p_brand_id: string;
          p_commission_rate?: number;
          p_currency?: string;
          p_external_product_id: string;
          p_image_url?: string;
          p_is_active?: boolean;
          p_name: string;
          p_price?: number;
          p_product_id?: string;
        };
        Returns: Json;
      };
      set_contest_entry_target: {
        Args: { p_actor_id: string; p_entry_id: string; p_target?: number };
        Returns: Json;
      };
      set_contest_products: {
        Args: {
          p_actor_id: string;
          p_contest_id: string;
          p_product_ids: string[];
        };
        Returns: Json;
      };
      set_contest_status: {
        Args: {
          p_actor_id: string;
          p_contest_id: string;
          p_status: Database['public']['Enums']['contest_status'];
        };
        Returns: Json;
      };
      set_offer_stage: {
        Args: {
          p_actor_id: string;
          p_application_id: string;
          p_note?: string;
          p_stage: Database['public']['Enums']['offer_stage'];
        };
        Returns: Json;
      };
      settle_contest: {
        Args: { p_actor_id: string; p_contest_id: string; p_message?: string };
        Returns: Json;
      };
      stage_is_before_content_done: {
        Args: { p_stage: Database['public']['Enums']['offer_stage'] };
        Returns: boolean;
      };
      submit_content: {
        Args: {
          p_actor_id: string;
          p_ad_authorized?: boolean;
          p_ad_code: string;
          p_application_id: string;
          p_embed_id?: string;
          p_thumbnail_url?: string;
          p_video_author?: string;
          p_video_title?: string;
          p_video_url: string;
        };
        Returns: Json;
      };
      submit_contest_content: {
        Args: {
          p_actor_id: string;
          p_ad_authorized?: boolean;
          p_ad_code: string;
          p_embed_id?: string;
          p_entry_id: string;
          p_thumbnail_url?: string;
          p_video_author?: string;
          p_video_title?: string;
          p_video_url: string;
        };
        Returns: Json;
      };
      submit_contest_progress: {
        Args: {
          p_actor_id: string;
          p_entry_id: string;
          p_gmv: number;
          p_video_count: number;
          p_videos?: Json;
        };
        Returns: Json;
      };
      tiktok_days_to_backfill: { Args: never; Returns: number };
      tiktok_posted_at: { Args: { p_item_id: string }; Returns: string };
      tiktok_run_nightly_sync: {
        Args: { p_days?: number; p_refresh_days?: number };
        Returns: number;
      };
      tiktok_set_sync_secret: { Args: { p_secret: string }; Returns: undefined };
      tiktok_set_sync_url: { Args: { p_url: string }; Returns: undefined };
      update_content: {
        Args: {
          p_actor_id: string;
          p_ad_authorized?: boolean;
          p_ad_code: string;
          p_content_id: string;
          p_embed_id?: string;
          p_thumbnail_url?: string;
          p_video_author?: string;
          p_video_title?: string;
          p_video_url: string;
        };
        Returns: Json;
      };
      withdraw_contest_entry: {
        Args: { p_actor_id: string; p_entry_id: string };
        Returns: Json;
      };
      withdraw_offer_application: {
        Args: { p_actor_id: string; p_application_id: string };
        Returns: Json;
      };
    };
    Enums: {
      app_role:
        | 'applicant'
        | 'creator'
        | 'creative_strategist'
        | 'ops'
        | 'admin'
        | 'affiliate_team_lead'
        | 'operations_lead'
        | 'ads_manager';
      application_status: 'pending' | 'approved' | 'rejected';
      content_status: 'submitted' | 'approved' | 'needs_another_take';
      contest_deliverable_type: 'gmv' | 'video_count';
      contest_entry_status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
      contest_progress_status: 'pending' | 'confirmed' | 'rejected';
      contest_status: 'active' | 'inactive';
      creator_tier: 'creator' | 'rising' | 'pro' | 'elite';
      offer_application_status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
      offer_kind: 'retainer' | 'volume' | 'high_commission';
      offer_stage:
        | 'pending_request'
        | 'sample_requested'
        | 'sample_shipped'
        | 'content_pending'
        | 'content_completed'
        | 'payment_pending'
        | 'paid';
      offer_status: 'active' | 'inactive';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        'applicant',
        'creator',
        'creative_strategist',
        'ops',
        'admin',
        'affiliate_team_lead',
        'operations_lead',
        'ads_manager',
      ],
      application_status: ['pending', 'approved', 'rejected'],
      content_status: ['submitted', 'approved', 'needs_another_take'],
      contest_deliverable_type: ['gmv', 'video_count'],
      contest_entry_status: ['pending', 'approved', 'rejected', 'withdrawn'],
      contest_progress_status: ['pending', 'confirmed', 'rejected'],
      contest_status: ['active', 'inactive'],
      creator_tier: ['creator', 'rising', 'pro', 'elite'],
      offer_application_status: ['pending', 'approved', 'rejected', 'withdrawn'],
      offer_kind: ['retainer', 'volume', 'high_commission'],
      offer_stage: [
        'pending_request',
        'sample_requested',
        'sample_shipped',
        'content_pending',
        'content_completed',
        'payment_pending',
        'paid',
      ],
      offer_status: ['active', 'inactive'],
    },
  },
} as const;
