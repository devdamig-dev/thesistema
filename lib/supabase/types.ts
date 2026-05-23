/**
 * Tipos de la base de Supabase.
 *
 * En el sprint 0 los definimos a mano para tener autocompletado en los
 * repositorios sin depender todavía de `supabase gen types`. En sprints
 * próximos se regeneran automáticamente con:
 *
 *   npx supabase gen types typescript --project-id <id> > lib/supabase/types.ts
 */

import type {
  ApprovalStatus,
  CampaignChannel,
  CampaignStatus,
  CampaignType,
  Industry,
  InvoiceLifecycle,
  InvoiceType,
  ModuleKey,
  RoleKey,
  SalesChannel,
  StockMovementReason,
  Priority,
} from "@/lib/entities";

type Timestamps = {
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: Timestamps & {
          id: string;
          name: string;
          owner_id: string;
          plan: "free" | "pro" | "enterprise";
        };
        Insert: Partial<Database["public"]["Tables"]["organizations"]["Row"]> & {
          name: string;
          owner_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["organizations"]["Row"]>;
      };
      businesses: {
        Row: Timestamps & {
          id: string;
          organization_id: string;
          name: string;
          industry: Industry;
          tax_id: string | null;
          timezone: string;
        };
        Insert: Partial<Database["public"]["Tables"]["businesses"]["Row"]> & {
          organization_id: string;
          name: string;
          industry: Industry;
        };
        Update: Partial<Database["public"]["Tables"]["businesses"]["Row"]>;
      };
      branches: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          name: string;
          address: string | null;
          is_main: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["branches"]["Row"]> & {
          business_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["branches"]["Row"]>;
      };
      profiles: {
        Row: Timestamps & {
          id: string; // uuid = auth.users.id
          organization_id: string | null;
          full_name: string;
          email: string | null;
          phone: string | null;
          avatar_url: string | null;
          active: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
          full_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
      };
      business_members: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          user_id: string;
          role: RoleKey;
        };
        Insert: {
          id?: string;
          business_id: string;
          user_id: string;
          role: RoleKey;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["business_members"]["Row"]>;
      };
      business_modules: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          module_key: ModuleKey;
          enabled: boolean;
          suggested: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["business_modules"]["Row"]> & {
          business_id: string;
          module_key: ModuleKey;
        };
        Update: Partial<Database["public"]["Tables"]["business_modules"]["Row"]>;
      };
      suppliers: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          name: string;
          tax_id: string | null;
          category: string | null;
          phone: string | null;
          email: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["suppliers"]["Row"]> & {
          business_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["suppliers"]["Row"]>;
      };
      ingredients: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          name: string;
          unit: string;
          avg_unit_cost: number;
        };
        Insert: Partial<Database["public"]["Tables"]["ingredients"]["Row"]> & {
          business_id: string;
          name: string;
          unit: string;
        };
        Update: Partial<Database["public"]["Tables"]["ingredients"]["Row"]>;
      };
      stock_items: {
        Row: Timestamps & {
          id: string;
          ingredient_id: string;
          branch_id: string;
          current: number;
          min: number;
        };
        Insert: Partial<Database["public"]["Tables"]["stock_items"]["Row"]> & {
          ingredient_id: string;
          branch_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["stock_items"]["Row"]>;
      };
      stock_movements: {
        Row: Timestamps & {
          id: string;
          ingredient_id: string;
          branch_id: string;
          reason: StockMovementReason;
          qty: number;
          ref_type: "purchase" | "sale" | "closure" | null;
          ref_id: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["stock_movements"]["Row"]> & {
          ingredient_id: string;
          branch_id: string;
          reason: StockMovementReason;
          qty: number;
        };
        Update: Partial<Database["public"]["Tables"]["stock_movements"]["Row"]>;
      };
      products: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          name: string;
          category: string;
          price: number;
          cost: number;
          active: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["products"]["Row"]> & {
          business_id: string;
          name: string;
          category: string;
          price: number;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Row"]>;
      };
      recipes: {
        Row: Timestamps & {
          id: string;
          product_id: string;
        };
        Insert: Partial<Database["public"]["Tables"]["recipes"]["Row"]> & {
          product_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["recipes"]["Row"]>;
      };
      recipe_items: {
        Row: Timestamps & {
          id: string;
          recipe_id: string;
          ingredient_id: string | null;
          name: string;
          qty: string;
          unit_cost: number;
          share: number;
        };
        Insert: Partial<Database["public"]["Tables"]["recipe_items"]["Row"]> & {
          recipe_id: string;
          name: string;
          qty: string;
          unit_cost: number;
        };
        Update: Partial<Database["public"]["Tables"]["recipe_items"]["Row"]>;
      };
      purchases: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          supplier_id: string | null;
          purchased_at: string;
          total: number;
          payment_method: string;
          invoice_id: string | null;
          created_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["purchases"]["Row"]> & {
          business_id: string;
          purchased_at: string;
          total: number;
          payment_method: string;
        };
        Update: Partial<Database["public"]["Tables"]["purchases"]["Row"]>;
      };
      purchase_items: {
        Row: Timestamps & {
          id: string;
          purchase_id: string;
          ingredient_id: string | null;
          description: string;
          qty: number;
          unit: string;
          unit_price: number;
          total: number;
        };
        Insert: Partial<Database["public"]["Tables"]["purchase_items"]["Row"]> & {
          purchase_id: string;
          description: string;
          qty: number;
          unit_price: number;
          total: number;
        };
        Update: Partial<Database["public"]["Tables"]["purchase_items"]["Row"]>;
      };
      sales: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          branch_id: string | null;
          channel: SalesChannel;
          amount: number;
          occurred_at: string;
          product_id: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["sales"]["Row"]> & {
          business_id: string;
          channel: SalesChannel;
          amount: number;
          occurred_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["sales"]["Row"]>;
      };
      expenses: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          name: string;
          category: string;
          amount: number;
          due_date: string | null;
          status: "pending" | "scheduled" | "paid" | "variable" | "auto";
        };
        Insert: Partial<Database["public"]["Tables"]["expenses"]["Row"]> & {
          business_id: string;
          name: string;
          category: string;
          amount: number;
        };
        Update: Partial<Database["public"]["Tables"]["expenses"]["Row"]>;
      };
      employees: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          full_name: string;
          role: string;
          shift: string | null;
          monthly_hours: number;
          monthly_cost: number;
          pending_advance: number;
          absences: number;
          late_arrivals: number;
          active: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["employees"]["Row"]> & {
          business_id: string;
          full_name: string;
          role: string;
        };
        Update: Partial<Database["public"]["Tables"]["employees"]["Row"]>;
      };
      shifts: {
        Row: Timestamps & {
          id: string;
          employee_id: string;
          branch_id: string;
          weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
          from_time: string;
          to_time: string;
          hours: number;
        };
        Insert: Partial<Database["public"]["Tables"]["shifts"]["Row"]> & {
          employee_id: string;
          branch_id: string;
          weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
          from_time: string;
          to_time: string;
          hours: number;
        };
        Update: Partial<Database["public"]["Tables"]["shifts"]["Row"]>;
      };
      advance_payments: {
        Row: Timestamps & {
          id: string;
          employee_id: string;
          amount: number;
          paid_at: string;
          status: "pending" | "settled";
        };
        Insert: Partial<Database["public"]["Tables"]["advance_payments"]["Row"]> & {
          employee_id: string;
          amount: number;
          paid_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["advance_payments"]["Row"]>;
      };
      customers: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          name: string;
          phone: string | null;
          email: string | null;
          channel: string | null;
          visits: number;
          total_spend: number;
          last_visit_at: string | null;
          segment: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["customers"]["Row"]> & {
          business_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["customers"]["Row"]>;
      };
      invoices: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          supplier_id: string | null;
          number: string;
          type: InvoiceType;
          tax_id: string | null;
          invoice_date: string;
          due_date: string | null;
          payment_method: string;
          subtotal: number;
          tax: number;
          total: number;
          status: InvoiceLifecycle | "uploaded" | "extracted" | "rejected" | "failed";
          confidence: number;
          source: "foto" | "pdf";
          document_url: string | null;
          sender: string | null;
          storage_path: string | null;
          storage_bucket: string;
          file_mime: string | null;
          file_size: number | null;
          ocr_text: string | null;
          ocr_provider: string | null;
          processing_started_at: string | null;
          processing_completed_at: string | null;
          processing_error: string | null;
          ai_provider: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["invoices"]["Row"]> & {
          business_id: string;
          number: string;
          type: InvoiceType;
          invoice_date: string;
          subtotal: number;
          tax: number;
          total: number;
        };
        Update: Partial<Database["public"]["Tables"]["invoices"]["Row"]>;
      };
      invoice_items: {
        Row: Timestamps & {
          id: string;
          invoice_id: string;
          description: string;
          qty: string;
          unit_price: number;
          total: number;
          matched_ingredient_id: string | null;
          match_status: "matched" | "ambiguous" | "unmatched" | "manual";
          match_score: number | null;
          suggested_ingredient_id: string | null;
          unit: string;
          qty_numeric: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["invoice_items"]["Row"]> & {
          invoice_id: string;
          description: string;
          qty: string;
          unit_price: number;
          total: number;
        };
        Update: Partial<Database["public"]["Tables"]["invoice_items"]["Row"]>;
      };
      invoice_processing_logs: {
        Row: {
          id: string;
          invoice_id: string;
          stage: string;
          ok: boolean;
          message: string | null;
          data: unknown;
          duration_ms: number | null;
          created_at: string;
        };
        Insert: {
          invoice_id: string;
          stage: string;
          ok: boolean;
          message?: string | null;
          data?: unknown;
          duration_ms?: number | null;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["invoice_processing_logs"]["Row"]>;
      };
      daily_closures: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          branch_id: string | null;
          closure_date: string;
          raw_text: string;
          parsed: unknown;
          inconsistencies: unknown;
          status: ApprovalStatus;
          gross_total: number;
          net_total: number;
        };
        Insert: Partial<Database["public"]["Tables"]["daily_closures"]["Row"]> & {
          business_id: string;
          closure_date: string;
          raw_text: string;
          gross_total: number;
          net_total: number;
        };
        Update: Partial<Database["public"]["Tables"]["daily_closures"]["Row"]>;
      };
      whatsapp_messages: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          sender_id: string | null;
          sender_name: string;
          sender_role: string;
          channel: "text" | "audio" | "image" | "document";
          raw: string;
          preview: string;
          media_url: string | null;
          received_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["whatsapp_messages"]["Row"]> & {
          business_id: string;
          sender_name: string;
          channel: "text" | "audio" | "image" | "document";
          raw: string;
          received_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["whatsapp_messages"]["Row"]>;
      };
      ai_extractions: {
        Row: Timestamps & {
          id: string;
          message_id: string;
          business_id: string | null;
          type: string;
          fields: unknown;
          missing: string[];
          confidence: number;
          status: ApprovalStatus | "failed";
          source: "claude" | "heuristic" | "failed";
          summary: string | null;
          target_entity: string | null;
          target_record_id: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["ai_extractions"]["Row"]> & {
          message_id: string;
          type: string;
          fields: unknown;
          confidence: number;
        };
        Update: Partial<Database["public"]["Tables"]["ai_extractions"]["Row"]>;
      };
      ai_recommendations: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          area: string;
          priority: Priority;
          title: string;
          detail: string;
          estimated_impact: number;
          confidence: number;
          status: "open" | "applied" | "dismissed";
        };
        Insert: Partial<Database["public"]["Tables"]["ai_recommendations"]["Row"]> & {
          business_id: string;
          area: string;
          priority: Priority;
          title: string;
          detail: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_recommendations"]["Row"]>;
      };
      campaigns: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          name: string;
          channel: CampaignChannel;
          type: CampaignType;
          audience_segment: string;
          copy: string;
          scheduled_for: string | null;
          status: CampaignStatus;
          estimated_impact: number;
          confidence: number;
        };
        Insert: Partial<Database["public"]["Tables"]["campaigns"]["Row"]> & {
          business_id: string;
          name: string;
          channel: CampaignChannel;
          type: CampaignType;
          audience_segment: string;
          copy: string;
        };
        Update: Partial<Database["public"]["Tables"]["campaigns"]["Row"]>;
      };
      debts: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          creditor: string;
          supplier_id: string | null;
          concept: string | null;
          original_amount: number;
          pending_amount: number;
          interest_rate: number | null;
          due_date: string | null;
          status: "active" | "overdue" | "settled";
          taken_at: string;
          settled_at: string | null;
          notes: string | null;
          created_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["debts"]["Row"]> & {
          business_id: string;
          creditor: string;
          original_amount: number;
          pending_amount: number;
        };
        Update: Partial<Database["public"]["Tables"]["debts"]["Row"]>;
      };
      debt_payments: {
        Row: Timestamps & {
          id: string;
          debt_id: string;
          amount: number;
          paid_at: string;
          payment_method: string;
          notes: string | null;
          created_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["debt_payments"]["Row"]> & {
          debt_id: string;
          amount: number;
        };
        Update: Partial<Database["public"]["Tables"]["debt_payments"]["Row"]>;
      };
      balance_snapshots: {
        Row: Timestamps & {
          id: string;
          business_id: string;
          period_month: string;
          sales_total: number;
          purchases_total: number;
          expenses_total: number;
          payroll_total: number;
          withdrawals_total: number;
          debt_payments_total: number;
          debts_pending: number;
          stock_valued: number;
          cash_estimated: number;
          gross_margin_pct: number | null;
          operating_result: number | null;
          net_result: number | null;
          generated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["balance_snapshots"]["Row"]> & {
          business_id: string;
          period_month: string;
        };
        Update: Partial<Database["public"]["Tables"]["balance_snapshots"]["Row"]>;
      };
    };
    Views: {};
    Functions: {
      user_organization_id: { Args: Record<string, never>; Returns: string };
      is_member_of_business: {
        Args: { business: string };
        Returns: boolean;
      };
    };
    Enums: {
      industry: Industry;
      role_key: RoleKey;
      module_key: ModuleKey;
      sales_channel: SalesChannel;
      invoice_type: InvoiceType;
      invoice_lifecycle: InvoiceLifecycle;
      approval_status: ApprovalStatus;
      campaign_channel: CampaignChannel;
      campaign_type: CampaignType;
      campaign_status: CampaignStatus;
      stock_movement_reason: StockMovementReason;
      priority: Priority;
    };
  };
};
