type Rec = Record<string, unknown>;

export function slimForms(data: { items?: Rec[]; total_items?: number; page_count?: number }) {
  return {
    total_items: data.total_items,
    page_count: data.page_count,
    items: (data.items ?? []).map((f) => ({
      id: f.id,
      title: f.title,
      last_updated_at: f.last_updated_at,
      created_at: f.created_at,
      type: f.type,
    })),
  };
}

export function slimResponse(r: Rec) {
  return {
    response_id: r.response_id,
    submitted_at: r.submitted_at,
    landed_at: r.landed_at,
    answers: (r.answers as Rec[] | undefined)?.map((a) => ({
      field: { id: (a.field as Rec)?.id, ref: (a.field as Rec)?.ref, type: (a.field as Rec)?.type },
      type: a.type,
      [String(a.type)]: a[String(a.type)],
    })),
  };
}

export function slimResponses(data: { items?: Rec[]; total_items?: number; page_count?: number }) {
  return {
    total_items: data.total_items,
    page_count: data.page_count,
    items: (data.items ?? []).map(slimResponse),
  };
}
