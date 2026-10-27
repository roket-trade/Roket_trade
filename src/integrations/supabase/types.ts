export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      payments: {
        Row: {
          created_at: string
          deposit_amount: number
          id: string
          network: string
          plan_name: string
          status: string
          tx_hash: string
          user_id: string | null
          wallet_address: string
        }
        Insert: {
          created_at?: string
          deposit_amount: number
          id?: string
          network: string
          plan_name: string
          status?: string
          tx_hash: string
          user_id?: string | null
          wallet_address: string
        }
        Update: {
          created_at?: string
          deposit_amount?: number
          id?: string
          network?: string
          plan_name?: string
          status?: string
          tx_hash?: string
          user_id?: string | null
          wallet_address?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          created_at: string
          default_wallet_address: string | null
          default_wallet_type: string | null
          earnings_adjustment: number
          extra_balance: number | null
          full_name: string
          id: string
          id_card_url: string | null
          is_admin: boolean
          is_suspended: boolean
          kyc_status: string | null
          last_withdraw_at: string | null
          main_balance: number | null
          phone_number: string | null
          plan_expires_at: string | null
          plan_name: string | null
          plan_started_at: string | null
          referral_code: string
          referred_by: string | null
          saved_wallets: Json | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          default_wallet_address?: string | null
          default_wallet_type?: string | null
          earnings_adjustment?: number
          extra_balance?: number | null
          full_name: string
          id: string
          id_card_url?: string | null
          is_admin?: boolean
          is_suspended?: boolean
          kyc_status?: string | null
          last_withdraw_at?: string | null
          main_balance?: number | null
          phone_number?: string | null
          plan_expires_at?: string | null
          plan_name?: string | null
          plan_started_at?: string | null
          referral_code?: string
          referred_by?: string | null
          saved_wallets?: Json | null
        }
        Update: {
          address?: string | null
          created_at?: string
          default_wallet_address?: string | null
          default_wallet_type?: string | null
          earnings_adjustment?: number
          extra_balance?: number | null
          full_name?: string
          id?: string
          id_card_url?: string | null
          is_admin?: boolean
          is_suspended?: boolean
          kyc_status?: string | null
          last_withdraw_at?: string | null
          main_balance?: number | null
          phone_number?: string | null
          plan_expires_at?: string | null
          plan_name?: string | null
          plan_started_at?: string | null
          referral_code?: string
          referred_by?: string | null
          saved_wallets?: Json | null
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          admin_reply: string | null
          category: string | null
          created_at: string
          id: string
          image_url: string | null
          message: string
          resolved_at: string | null
          status: string
          subject: string
          user_id: string | null
        }
        Insert: {
          admin_reply?: string | null
          category?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          message: string
          resolved_at?: string | null
          status?: string
          subject: string
          user_id?: string | null
        }
        Update: {
          admin_reply?: string | null
          category?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          message?: string
          resolved_at?: string | null
          status?: string
          subject?: string
          user_id?: string | null
        }
        Relationships: []
      }
      announcements: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          message: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          message: string
          title: string
          type?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          message?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          sender_id: string | null
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          sender_id?: string | null
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          sender_id?: string | null
          ticket_id?: string
        }
        Relationships: []
      }

      transactions: {
        Row: {
          created_at: string
          deposit_amount: number | null
          description: string | null
          id: string
          last_verification_at: string | null
          network: string | null
          plan_name: string | null
          referred_user_id: string | null
          rejection_reason: string | null
          source_tx_id: string | null
          status: string
          tx_hash: string | null
          type: string
          user_id: string | null
          verification_attempts: number
          wallet_address: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          deposit_amount?: number | null
          description?: string | null
          id?: string
          last_verification_at?: string | null
          network?: string | null
          plan_name?: string | null
          referred_user_id?: string | null
          rejection_reason?: string | null
          source_tx_id?: string | null
          status?: string
          tx_hash?: string | null
          type: string
          user_id?: string | null
          verification_attempts?: number
          wallet_address?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          deposit_amount?: number | null
          description?: string | null
          id?: string
          last_verification_at?: string | null
          network?: string | null
          plan_name?: string | null
          referred_user_id?: string | null
          rejection_reason?: string | null
          source_tx_id?: string | null
          status?: string
          tx_hash?: string | null
          type?: string
          user_id?: string | null
          verification_attempts?: number
          wallet_address?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_user: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      admin_delete_user: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      recent_public_transactions: {
        Args: { row_limit: number }
        Returns: {
          id: string
          type: string
          amount: number
          created_at: string
          user_name: string | null
        }[]
      }
      admin_user_emails: {
        Args: { ids?: string[] | null }
        Returns: { id: string; email: string | null }[]
      }
      admin_user_aggregates: {
        Args: { ids?: string[] | null }
        Returns: {
          user_id: string
          total_earned: number
          total_withdrawn: number
          available_balance: number
          referral_count: number
          earnings_adjustment: number
        }[]
      }
      get_all_user_emails: {
        Args: { ids?: string[] | null }
        Returns: { id: string; email: string | null }[]
      }
      resolve_referral_code: {
        Args: { code: string }
        Returns: string | null
      }
      process_referral_bonus: {
        Args: { p_deposit_tx_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
