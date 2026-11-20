//! Incremental-update writer: the original bytes stay an exact prefix; changed and
//! new objects, a new cross-reference section (table or stream, matching the
//! original) and a trailer with `/Prev` are appended.
use std::collections::{HashMap, HashSet};

use lopdf::{
    Dictionary, Document, IncrementalDocument, Object, ObjectId, Stream, StringFormat, dictionary,
    text_string,
};

use super::appearance::{
    Appearance, TextLine, freetext_appearance, highlight_appearance, image_appearance, ink_appearance,
    line_appearance, shape_appearance, text_line_appearance,
};
use super::date::pdf_date;
use super::dto::{
    AnnotationDto, Background, Blend, Common, DeleteRef, Fill, ImageData, InkRole, PageOrder, PageSpec,
    ShapeKind, Stroke, TextAlign,
};
use super::fmt::fmt_num;
use super::image::{decode_base64, decode_png};
use super::{annotation_nm, format_source_ref, load_document, nm_owners, parse_source_ref};
use crate::error::AppError;

/// Where a page's `/Annots` array lives.
enum AnnotsHome {
    /// Inline in the page dictionary, or absent: the page object is revised.
    Page,
    /// An indirect array object: only that object is revised.
    Indirect(ObjectId),
}

struct PageAnnots {
    items: Vec<Object>,
    home: AnnotsHome,
    dirty: bool,
}

struct Writer {
    inc: IncrementalDocument,
    /// The saved document's pages in order (annotation `page` indexes this).
    pages: Vec<ObjectId>,
    /// Final `/Rotate` of each page when a page plan was applied; without one
    /// each page's rotation is read from the file when needed.
    rotations: Option<Vec<i32>>,
    annots: HashMap<ObjectId, PageAnnots>,
    /// `nm_owners` of the original document, computed on first use.
    owners: Option<HashMap<String, ObjectId>>,
    /// Appearance forms of flattened annotations to paint into each page's
    /// content, in z-order (see `flatten`).
    flat: HashMap<ObjectId, Vec<ObjectId>>,
}

/// Returns the new file bytes and `id → sourceRef` for every written annotation.
pub fn write_incremental(
    original: &[u8],
    upserts: &[AnnotationDto],
    deletes: &[DeleteRef],
) -> Result<(Vec<u8>, HashMap<String, String>), AppError> {
    write_incremental_with_pages(original, upserts, deletes, None)
}

/// Like `write_incremental`; with a page plan the saved document has exactly
/// those pages, in that order (see `Writer::apply_page_plan`), and the
/// annotations' `page` indexes the plan. `None` leaves the pages as they are.
pub fn write_incremental_with_pages(
    original: &[u8],
    upserts: &[AnnotationDto],
    deletes: &[DeleteRef],
    pages: Option<&[PageSpec]>,
) -> Result<(Vec<u8>, HashMap<String, String>), AppError> {
    write_incremental_ordered(original, upserts, deletes, pages, &[])
}

/// Like `write_incremental_with_pages`; afterwards each page in `orders` has
/// its annotations in that order in `/Annots` (see `Writer::apply_order`).
pub fn write_incremental_ordered(
    original: &[u8],
    upserts: &[AnnotationDto],
    deletes: &[DeleteRef],
    pages: Option<&[PageSpec]>,
    orders: &[PageOrder],
) -> Result<(Vec<u8>, HashMap<String, String>), AppError> {
    let doc = load_document(original)?;
    let mut w = Writer::new(original, doc);
    if let Some(plan) = pages {
        w.apply_page_plan(plan)?;
    }
    let mut refs = HashMap::new();
    for dto in upserts {
        if let Some((id, source_ref)) = w.upsert(dto)? {
            refs.insert(id, source_ref);
        }
    }
    for d in deletes {
        // A ref that now names another annotation (the file changed since it
        // was loaded) is left alone, like upserts.
        if let Some(id) = parse_source_ref(&d.source_ref)
            && w.is_same_annotation(id, &d.id)
        {
            w.detach(id);
        }
    }
    for order in orders {
        w.apply_order(order, &refs);
    }
    Ok((w.finish()?, refs))
}

impl Writer {
    fn new(original: &[u8], doc: Document) -> Self {
        let pages: Vec<ObjectId> = doc.page_iter().collect();
        // Never reuse object numbers below the original /Size (free entries included).
        let size = doc
            .trailer
            .get(b"Size")
            .and_then(Object::as_i64)
            .unwrap_or(0);
        let max_id = doc.max_id.max(u32::try_from(size - 1).unwrap_or(0));
        let mut trailer = dictionary! {};
        for key in [b"Root".as_slice(), b"Info", b"ID"] {
            if let Ok(v) = doc.trailer.get(key) {
                trailer.set(key, v.clone());
            }
        }
        let prev_start = doc.xref_start;
        let mut inc = IncrementalDocument::create_from(original.to_vec(), doc);
        // A fresh trailer: an xref-stream dictionary from the original would carry
        // /W, /Index, /Filter, /DecodeParms that do not describe the new section,
        // and a hybrid file's /XRefStm must not shadow the /Prev chain.
        if prev_start != 0 {
            trailer.set("Prev", prev_start as i64);
        }
        inc.new_document.trailer = trailer;
        inc.new_document.max_id = max_id;
        Writer {
            inc,
            pages,
            rotations: None,
            annots: HashMap::new(),
            owners: None,
            flat: HashMap::new(),
        }
    }

    fn prev(&self) -> &Document {
        self.inc.get_prev_documents()
    }

    /// Makes the root `/Pages` node list exactly the planned pages (a flat
    /// tree). The first occurrence of a file page keeps its object (revised
    /// when its `/Rotate` or `/Parent` changes); later occurrences are new
    /// copies without annotations; blank pages are new. Pages left out stay
    /// in the file as unreachable objects.
    fn apply_page_plan(&mut self, plan: &[PageSpec]) -> Result<(), AppError> {
        if plan.is_empty() {
            return Err(AppError::InvalidPdf("the page plan has no pages".into()));
        }
        let root = self
            .prev()
            .catalog()
            .and_then(|c| c.get(b"Pages"))
            .and_then(Object::as_reference)
            .map_err(invalid)?;
        let source = std::mem::take(&mut self.pages);
        let mut used = HashSet::new();
        let mut pages = Vec::with_capacity(plan.len());
        let mut rotations = Vec::with_capacity(plan.len());
        for spec in plan {
            let (id, rotate) = match *spec {
                PageSpec::Source { index, rotate } => {
                    let rotate = plan_rotation(rotate)?;
                    let src = *source.get(index as usize).ok_or_else(|| {
                        AppError::InvalidPdf(format!("page {index} out of range"))
                    })?;
                    let id = if used.insert(src) {
                        self.reuse_page(src, root, rotate)?;
                        src
                    } else {
                        self.copy_page(src, root, rotate)?
                    };
                    (id, rotate)
                }
                PageSpec::Blank { width, height, rotate } => {
                    let rotate = plan_rotation(rotate)?;
                    if !(width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0) {
                        return Err(AppError::InvalidPdf("invalid empty page size".into()));
                    }
                    (self.blank_page(width, height, root, rotate), rotate)
                }
            };
            pages.push(id);
            rotations.push(rotate);
        }
        self.inc
            .opt_clone_object_to_new_document(root)
            .map_err(invalid)?;
        let node = self
            .inc
            .new_document
            .get_dictionary_mut(root)
            .map_err(invalid)?;
        node.set(
            "Kids",
            pages.iter().map(|&id| Object::Reference(id)).collect::<Vec<_>>(),
        );
        node.set("Count", pages.len() as i64);
        self.pages = pages;
        self.rotations = Some(rotations);
        Ok(())
    }

    /// Keeps file page `id` as a direct kid of `root` with `/Rotate rotate`:
    /// revised only if either differs.
    fn reuse_page(&mut self, id: ObjectId, root: ObjectId, rotate: i32) -> Result<(), AppError> {
        let prev = self.prev();
        let parent = prev
            .get_dictionary(id)
            .map_err(invalid)?
            .get(b"Parent")
            .and_then(Object::as_reference)
            .ok();
        if parent == Some(root) && page_rotation(prev, id) == rotate {
            return Ok(());
        }
        let dict = flattened_page(prev, id, root, rotate)?;
        self.inc.new_document.set_object(id, dict);
        Ok(())
    }

    /// A new page drawing the same content as file page `id`, without its
    /// annotations (and structure or article references, which belong to the
    /// original).
    fn copy_page(&mut self, id: ObjectId, root: ObjectId, rotate: i32) -> Result<ObjectId, AppError> {
        let mut dict = flattened_page(self.prev(), id, root, rotate)?;
        for key in [b"Annots".as_slice(), b"StructParents", b"B"] {
            dict.remove(key);
        }
        Ok(self.inc.new_document.add_object(dict))
    }

    fn blank_page(&mut self, width: f64, height: f64, root: ObjectId, rotate: i32) -> ObjectId {
        let doc = &mut self.inc.new_document;
        let contents = doc.add_object(Stream::new(Dictionary::new(), Vec::new()));
        let bbox = nums(&[0.0, 0.0, width, height]);
        // An explicit /CropBox: one inherited from the root /Pages node would crop the page.
        doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => root,
            "MediaBox" => bbox.clone(),
            "CropBox" => bbox,
            "Rotate" => rotate,
            "Resources" => Dictionary::new(),
            "Contents" => contents,
        })
    }

    /// Current `/Annots` of a page, loaded once and then edited in memory.
    fn page_annots(&mut self, page_id: ObjectId) -> &mut PageAnnots {
        if !self.annots.contains_key(&page_id) {
            let prev = self.inc.get_prev_documents();
            let page = prev.get_dictionary(page_id).ok();
            let entry = match page.and_then(|p| p.get(b"Annots").ok()) {
                Some(Object::Reference(arr_id)) => PageAnnots {
                    items: prev
                        .get_object(*arr_id)
                        .and_then(Object::as_array)
                        .cloned()
                        .unwrap_or_default(),
                    home: AnnotsHome::Indirect(*arr_id),
                    dirty: false,
                },
                Some(Object::Array(items)) => PageAnnots {
                    items: items.clone(),
                    home: AnnotsHome::Page,
                    dirty: false,
                },
                _ => PageAnnots {
                    items: Vec::new(),
                    home: AnnotsHome::Page,
                    dirty: false,
                },
            };
            self.annots.insert(page_id, entry);
        }
        self.annots.get_mut(&page_id).expect("inserted above")
    }

    fn page_containing(&mut self, id: ObjectId) -> Option<ObjectId> {
        let pages = self.pages.clone();
        pages
            .into_iter()
            .find(|&p| self.page_annots(p).items.contains(&Object::Reference(id)))
    }

    /// Removes the reference from whichever page lists it; unknown refs are ignored.
    fn detach(&mut self, id: ObjectId) {
        if let Some(page) = self.page_containing(id) {
            let a = self.page_annots(page);
            a.items.retain(|o| *o != Object::Reference(id));
            a.dirty = true;
        }
    }

    /// Rearranges the page's `/Annots` so the listed annotations come in the
    /// order given. Each is found by the ref this save wrote it to (`refs`),
    /// else by the ref it was saved as, if that object is still it. Entries
    /// that are not listed (links, form fields, annotations the order cannot
    /// place) keep their slots; the listed ones are dealt out to the slots
    /// they occupy. A page out of range is ignored.
    fn apply_order(&mut self, order: &PageOrder, refs: &HashMap<String, String>) {
        let Some(&page_id) = self.pages.get(order.page as usize) else {
            return;
        };
        let mut wanted = Vec::new();
        for a in &order.annotations {
            let id = match refs.get(&a.id) {
                Some(r) => parse_source_ref(r),
                None => a
                    .source_ref
                    .as_deref()
                    .and_then(parse_source_ref)
                    .filter(|&id| self.is_same_annotation(id, &a.id)),
            };
            if let Some(id) = id
                && !wanted.contains(&id)
            {
                wanted.push(id);
            }
        }
        let annots = self.page_annots(page_id);
        let listed = |o: &Object| matches!(o, Object::Reference(id) if wanted.contains(id));
        let slots: Vec<usize> = (0..annots.items.len()).filter(|&i| listed(&annots.items[i])).collect();
        let placed = wanted
            .iter()
            .filter(|&&id| annots.items.contains(&Object::Reference(id)))
            .map(|&id| Object::Reference(id))
            .collect::<Vec<_>>();
        for (slot, item) in slots.into_iter().zip(placed) {
            if annots.items[slot] != item {
                annots.items[slot] = item;
                annots.dirty = true;
            }
        }
    }

    fn attach(&mut self, page: ObjectId, id: ObjectId) {
        let a = self.page_annots(page);
        if !a.items.contains(&Object::Reference(id)) {
            a.items.push(Object::Reference(id));
            a.dirty = true;
        }
    }

    /// The annotation the source ref points to, if some page still lists it in
    /// `/Annots` (so a stale or bogus ref can never overwrite a non-annotation object).
    fn existing(&mut self, source_ref: Option<&str>) -> Option<ObjectId> {
        let id = parse_source_ref(source_ref?)?;
        self.prev().get_dictionary(id).ok()?;
        self.page_containing(id).map(|_| id)
    }

    /// Whether the object at `id` is the annotation `dto_id` was read as. An
    /// object whose `/NM` names another annotation is not (the file changed
    /// since it was loaded), unless the reader gave it a fresh id because an
    /// earlier object carries the same `/NM`. Without `/NM` there is nothing
    /// to check against.
    fn is_same_annotation(&mut self, id: ObjectId, dto_id: &str) -> bool {
        let prev = self.inc.get_prev_documents();
        let Some(nm) = prev.get_dictionary(id).ok().and_then(|d| annotation_nm(prev, d)) else {
            return true;
        };
        if nm == dto_id {
            return true;
        }
        let owners = self.owners.get_or_insert_with(|| nm_owners(prev));
        owners.get(&nm) != Some(&id)
    }

    fn upsert(&mut self, dto: &AnnotationDto) -> Result<Option<(String, String)>, AppError> {
        let common = common_of(dto);
        let page_id = *self
            .pages
            .get(common.page as usize)
            .ok_or_else(|| AppError::InvalidPdf(format!("page {} out of range", common.page)))?;
        let existing = self
            .existing(common.source_ref.as_deref())
            .filter(|&id| self.is_same_annotation(id, &common.id));

        let rotation = match &self.rotations {
            Some(r) => r[common.page as usize],
            None => page_rotation(self.prev(), page_id),
        };
        if common.flattened {
            self.flatten(dto, page_id, rotation, existing)?;
            return Ok(None);
        }
        let Some((mut annot, ap)) = build_annotation(dto, rotation)? else {
            // Nothing to draw (e.g. every stroke erased): drop any saved version.
            if let Some(id) = existing {
                self.detach(id);
            }
            return Ok(None);
        };
        let image = match dto {
            AnnotationDto::Image { image, .. } => Some(self.image_objects(image, existing)?),
            _ => None,
        };
        if let Some(im) = &image {
            annot.set(
                "JuliePDF",
                dictionary! { "v" => 1, "kind" => "image", "png" => im.png },
            );
        }
        let ap_id = add_appearance(&mut self.inc.new_document, &ap, image.map(|im| im.xobject))?;
        annot.set("Rect", nums(&ap.rect()));
        annot.set("AP", dictionary! { "N" => ap_id });
        annot.set("P", page_id);
        common_entries(&mut annot, common);

        let id = match existing {
            Some(id) => {
                if self.page_containing(id) != Some(page_id) {
                    self.detach(id);
                }
                // Keep keys JuliePDF does not own (/Contents, /Popup, /RC,
                // /CreationDate, /StructParent, …): overwrite only ours.
                let mut merged = self.prev().get_dictionary(id).cloned().unwrap_or_default();
                let stale: &[&[u8]] = match dto {
                    // Rich text, callout and intent of the old version would
                    // make other viewers show stale text or a callout line.
                    AnnotationDto::Freetext { .. } => &[b"RC", b"RD", b"CL", b"IT"],
                    // An old inset or cloudy border effect would no longer
                    // match the new /Rect and appearance.
                    AnnotationDto::Shape { .. } => &[b"RD", b"BE"],
                    // The other subtype's points, and leader lines, caption,
                    // fill and measure of a foreign line our appearance does
                    // not draw.
                    AnnotationDto::Line { .. } => &[
                        b"L", b"Vertices", b"LL", b"LLE", b"LLO", b"Cap", b"CP", b"CO", b"IC", b"IT", b"Measure",
                        b"BE", b"RD",
                    ],
                    _ => &[],
                };
                for key in stale {
                    merged.remove(key);
                }
                for (k, v) in annot {
                    merged.set(k, v);
                }
                self.inc.new_document.set_object(id, merged);
                id
            }
            None => self.inc.new_document.add_object(annot),
        };
        self.attach(page_id, id);
        Ok(Some((common.id.clone(), format_source_ref(id))))
    }

    /// Burns an annotation into its page: its appearance becomes a form
    /// XObject painted by the page content (see `write_flattened`), so it
    /// looks the same in every viewer but is no longer an annotation. A saved
    /// version (`existing`) is removed from the page's `/Annots`.
    fn flatten(
        &mut self,
        dto: &AnnotationDto,
        page_id: ObjectId,
        rotation: i32,
        existing: Option<ObjectId>,
    ) -> Result<(), AppError> {
        if let Some(id) = existing {
            self.detach(id);
        }
        let Some((_, ap)) = build_annotation(dto, rotation)? else {
            return Ok(());
        };
        let image = match dto {
            AnnotationDto::Image { image, .. } => Some(self.image_objects(image, existing)?.xobject),
            _ => None,
        };
        let form = add_appearance(&mut self.inc.new_document, &ap, image)?;
        self.flat.entry(page_id).or_default().push(form);
        Ok(())
    }

    /// An object of the document as it will be saved: revised or new, else original.
    fn object(&self, id: ObjectId) -> Option<&Object> {
        self.inc
            .new_document
            .objects
            .get(&id)
            .or_else(|| self.prev().objects.get(&id))
    }

    /// Paints the flattened annotations' forms on their pages: each page's
    /// content is wrapped in `q … Q` (so whatever graphics state it leaves
    /// behind cannot shift the drawing), then a stream paints the forms, in
    /// order, in default user space (their appearance content uses absolute
    /// user-space coordinates, like an annotation's). The forms are added to
    /// the page's own `/Resources` under names it does not use yet.
    fn write_flattened(&mut self) -> Result<(), AppError> {
        for (page_id, forms) in std::mem::take(&mut self.flat) {
            self.inc
                .opt_clone_object_to_new_document(page_id)
                .map_err(invalid)?;
            let page = self
                .inc
                .new_document
                .get_dictionary(page_id)
                .map_err(invalid)?
                .clone();
            let res = match page.get(b"Resources") {
                Ok(o) => Some(o.clone()),
                Err(_) => {
                    let prev = self.prev();
                    prev.get_dictionary(page_id)
                        .ok()
                        .and_then(|p| inherited(prev, p, b"Resources"))
                        .cloned()
                }
            };
            let mut resources = self.dict_of(res.as_ref());
            let mut xobjects = self.dict_of(resources.get(b"XObject").ok());
            let mut draw = String::from("Q\n");
            let mut n = 0;
            for form in forms {
                let name = loop {
                    let name = format!("JPDFFlat{n}");
                    n += 1;
                    if !xobjects.has(name.as_bytes()) {
                        break name;
                    }
                };
                draw.push_str(&format!("q /{name} Do Q\n"));
                xobjects.set(name, form);
            }
            resources.set("XObject", xobjects);
            let mut contents = match page.get(b"Contents") {
                Ok(Object::Reference(id)) => match self.object(*id) {
                    Some(Object::Array(items)) => items.clone(),
                    Some(Object::Stream(_)) => vec![Object::Reference(*id)],
                    _ => Vec::new(),
                },
                Ok(Object::Array(items)) => items.clone(),
                _ => Vec::new(),
            };
            let doc = &mut self.inc.new_document;
            let open = doc.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
            let paint = doc.add_object(compressed_stream(Dictionary::new(), draw.as_bytes())?);
            contents.insert(0, Object::Reference(open));
            contents.push(Object::Reference(paint));
            let page = doc.get_dictionary_mut(page_id).map_err(invalid)?;
            page.set("Resources", resources);
            page.set("Contents", contents);
        }
        Ok(())
    }

    /// A copy of the dictionary `o` is or refers to; empty for anything else.
    fn dict_of(&self, o: Option<&Object>) -> Dictionary {
        match o {
            Some(Object::Dictionary(d)) => d.clone(),
            Some(Object::Reference(id)) => self
                .object(*id)
                .and_then(|o| o.as_dict().ok())
                .cloned()
                .unwrap_or_default(),
            _ => Dictionary::new(),
        }
    }

    /// The image XObject and the original PNG stream of a pasted image. An
    /// update of a saved image whose PNG is unchanged (moved or resized)
    /// reuses both objects instead of writing the data again.
    fn image_objects(&mut self, image: &ImageData, existing: Option<ObjectId>) -> Result<ImageObjects, AppError> {
        let png = decode_base64(&image.png)?;
        if let Some(saved) = existing.and_then(|id| saved_image(self.prev(), id))
            && saved.1 == png
        {
            return Ok(saved.0);
        }
        let pixels = decode_png(&png)?;
        let doc = &mut self.inc.new_document;
        let mut dict = dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => pixels.width as i64,
            "Height" => pixels.height as i64,
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8,
        };
        if let Some(alpha) = &pixels.alpha {
            let mask = dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => pixels.width as i64,
                "Height" => pixels.height as i64,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
            };
            dict.set("SMask", doc.add_object(compressed_stream(mask, alpha)?));
        }
        let xobject = doc.add_object(compressed_stream(dict, &pixels.rgb)?);
        // Already compressed: stored as is.
        let png = doc.add_object(Stream::new(Dictionary::new(), png).with_compression(false));
        Ok(ImageObjects { xobject, png })
    }

    fn finish(mut self) -> Result<Vec<u8>, AppError> {
        self.write_flattened()?;
        for (page_id, a) in std::mem::take(&mut self.annots) {
            if !a.dirty {
                continue;
            }
            match a.home {
                AnnotsHome::Indirect(arr_id) => self
                    .inc
                    .new_document
                    .set_object(arr_id, Object::Array(a.items)),
                AnnotsHome::Page => {
                    self.inc
                        .opt_clone_object_to_new_document(page_id)
                        .map_err(invalid)?;
                    let page = self
                        .inc
                        .new_document
                        .get_dictionary_mut(page_id)
                        .map_err(invalid)?;
                    page.set("Annots", Object::Array(a.items));
                }
            }
        }
        let mut out = Vec::new();
        self.inc
            .save_to(&mut out)
            .map_err(|e| AppError::Io(e.to_string()))?;
        Ok(out)
    }
}

/// Objects of a saved pasted image.
#[derive(Clone, Copy)]
struct ImageObjects {
    /// The image XObject (`/Im0` of the appearance).
    xobject: ObjectId,
    /// The original PNG file (`/JuliePDF /png`).
    png: ObjectId,
}

/// The objects of the pasted image annotation `id` as saved in `doc`, with
/// its PNG bytes; `None` unless it has both an `/Im0` and a PNG stream.
fn saved_image(doc: &Document, id: ObjectId) -> Option<(ImageObjects, Vec<u8>)> {
    let annot = doc.get_dictionary(id).ok()?;
    let private = annot.get_deref(b"JuliePDF", doc).and_then(Object::as_dict).ok()?;
    if private.get(b"kind").and_then(Object::as_name).ok()? != b"image" {
        return None;
    }
    let png = private.get(b"png").and_then(Object::as_reference).ok()?;
    let bytes = doc.get_object(png).and_then(Object::as_stream).ok()?.get_plain_content().ok()?;
    let ap = annot.get_deref(b"AP", doc).and_then(Object::as_dict).ok()?;
    let form = ap.get(b"N").and_then(Object::as_reference).ok()?;
    let form = doc.get_object(form).and_then(Object::as_stream).ok()?;
    let resources = form.dict.get_deref(b"Resources", doc).and_then(Object::as_dict).ok()?;
    let xobject = resources
        .get_deref(b"XObject", doc)
        .and_then(Object::as_dict)
        .ok()?
        .get(b"Im0")
        .and_then(Object::as_reference)
        .ok()?;
    doc.get_object(xobject).and_then(Object::as_stream).ok()?;
    Some((ImageObjects { xobject, png }, bytes))
}

pub(crate) fn invalid(e: lopdf::Error) -> AppError {
    AppError::InvalidPdf(e.to_string())
}

pub(crate) fn common_of(dto: &AnnotationDto) -> &Common {
    match dto {
        AnnotationDto::Ink { common, .. }
        | AnnotationDto::Highlight { common, .. }
        | AnnotationDto::Underline { common, .. }
        | AnnotationDto::Strikeout { common, .. }
        | AnnotationDto::Freetext { common, .. }
        | AnnotationDto::Shape { common, .. }
        | AnnotationDto::Line { common, .. }
        | AnnotationDto::Image { common, .. } => common,
    }
}

/// Subtype-specific keys plus the appearance. `None` = nothing to draw.
/// Every key set here (and in `upsert`/`common_entries`) is owned by JuliePDF:
/// updating an existing annotation overwrites exactly these and keeps the rest.
/// Adding a kind = one match arm calling its appearance builder.
/// `page_rotation` is the page's `/Rotate` (FreeText text is turned upright on screen).
fn build_annotation(
    dto: &AnnotationDto,
    page_rotation: i32,
) -> Result<Option<(Dictionary, Appearance)>, AppError> {
    match dto {
        AnnotationDto::Ink {
            strokes,
            color,
            width,
            opacity,
            blend,
            role,
            ..
        } => {
            check_finite(
                strokes
                    .iter()
                    .flatten()
                    .flatten()
                    .chain(color)
                    .chain([width, opacity]),
            )?;
            if strokes.iter().all(|s| s.is_empty()) {
                return Ok(None);
            }
            let ap = ink_appearance(strokes, *color, *width, *opacity, *blend == Blend::Multiply);
            let ink_list: Vec<Object> = strokes
                .iter()
                .filter(|s| !s.is_empty())
                .map(|s| Object::Array(s.iter().flat_map(|p| [num(p[0]), num(p[1])]).collect()))
                .collect();
            let role = match role {
                InkRole::Pen => "pen",
                InkRole::Marker => "marker",
            };
            let d = dictionary! {
                "Subtype" => "Ink",
                "C" => nums(color),
                "CA" => num(*opacity),
                "InkList" => ink_list,
                "BS" => dictionary! { "W" => num(*width), "S" => "S" },
                "JuliePDF" => dictionary! { "v" => 1, "role" => role, "blend" => blend_name(*blend) },
            };
            Ok(Some((d, ap)))
        }
        AnnotationDto::Highlight {
            quads,
            color,
            opacity,
            ..
        } => {
            check_finite(quads.iter().flatten().chain(color).chain([opacity]))?;
            if quads.is_empty() {
                return Ok(None);
            }
            let ap = highlight_appearance(quads, *color, *opacity);
            let d = dictionary! {
                "Subtype" => "Highlight",
                "C" => nums(color),
                "CA" => num(*opacity),
                "QuadPoints" => nums(&quads.concat()),
                "JuliePDF" => dictionary! { "v" => 1 },
            };
            Ok(Some((d, ap)))
        }
        AnnotationDto::Underline { quads, color, .. } | AnnotationDto::Strikeout { quads, color, .. } => {
            check_finite(quads.iter().flatten().chain(color))?;
            if quads.is_empty() {
                return Ok(None);
            }
            let (kind, subtype) = match dto {
                AnnotationDto::Underline { .. } => (TextLine::Underline, "Underline"),
                _ => (TextLine::StrikeOut, "StrikeOut"),
            };
            let d = dictionary! {
                "Subtype" => subtype,
                "C" => nums(color),
                "CA" => 1,
                "QuadPoints" => nums(&quads.concat()),
                "JuliePDF" => dictionary! { "v" => 1 },
            };
            Ok(Some((d, text_line_appearance(quads, kind, *color))))
        }
        AnnotationDto::Freetext {
            rect,
            text,
            lines,
            font_size,
            text_color,
            background,
            align,
            ..
        } => {
            check_finite(
                rect.iter()
                    .chain(text_color)
                    .chain([font_size])
                    .chain(background.iter().flat_map(|b| b.color.iter().chain([&b.opacity]))),
            )?;
            if text.trim().is_empty() {
                return Ok(None);
            }
            // The TS side wraps; a DTO without lines falls back to the hard breaks.
            let fallback: Vec<String>;
            let lines = if lines.is_empty() {
                fallback = text.split('\n').map(|l| l.trim_end_matches('\r').to_string()).collect();
                &fallback
            } else {
                lines
            };
            let ap = freetext_appearance(
                *rect,
                lines,
                *font_size,
                *text_color,
                background.as_ref(),
                *align,
                page_rotation,
            );
            Ok(Some((freetext_dict(text, *font_size, *text_color, background.as_ref(), *align), ap)))
        }
        AnnotationDto::Shape {
            shape,
            rect,
            border,
            fill,
            ..
        } => {
            check_finite(
                rect.iter()
                    .chain(border.iter().flat_map(|b| b.color.iter().chain([&b.width, &b.opacity])))
                    .chain(fill.iter().flat_map(|f| f.color.iter().chain([&f.opacity]))),
            )?;
            let r = [rect[0].min(rect[2]), rect[1].min(rect[3]), rect[0].max(rect[2]), rect[1].max(rect[3])];
            if (border.is_none() && fill.is_none()) || r[2] <= r[0] || r[3] <= r[1] {
                return Ok(None);
            }
            let ap = shape_appearance(*shape, r, border.as_ref(), fill.as_ref());
            Ok(Some((shape_dict(*shape, r, border.as_ref(), fill.as_ref()), ap)))
        }
        AnnotationDto::Line {
            points,
            arrow,
            border,
            ..
        } => {
            check_finite(
                points
                    .iter()
                    .flatten()
                    .chain(&border.color)
                    .chain([&border.width, &border.opacity]),
            )?;
            if points.len() < 2 {
                return Ok(None);
            }
            Ok(Some((line_dict(points, *arrow, border), line_appearance(points, *arrow, border))))
        }
        // The image objects and `/JuliePDF` (with the PNG stream) are added by `upsert`.
        AnnotationDto::Image { rect, .. } => {
            check_finite(rect)?;
            let r = [rect[0].min(rect[2]), rect[1].min(rect[3]), rect[0].max(rect[2]), rect[1].max(rect[3])];
            if r[2] <= r[0] || r[3] <= r[1] {
                return Err(AppError::InvalidPdf("the image has no size".into()));
            }
            let d = dictionary! { "Subtype" => "Stamp", "Name" => "Image" };
            Ok(Some((d, image_appearance(r, page_rotation))))
        }
    }
}

/// `/C` is the border colour and `/IC` the fill colour, each an empty array
/// when absent (so an update also clears a previously saved colour); `/BS /W`
/// is 0 without a border. `/CA` stays 1: fill and border opacity differ and
/// live in the appearance's `GSf`/`GSs`. `/JuliePDF` keeps both opacities, the
/// presence of border and fill and the geometric rect (`/Rect` is the
/// stroke-expanded bounding box) for the reader.
fn shape_dict(shape: ShapeKind, rect: [f64; 4], border: Option<&Stroke>, fill: Option<&Fill>) -> Dictionary {
    let subtype = match shape {
        ShapeKind::Rect => "Square",
        ShapeKind::Circle => "Circle",
    };
    dictionary! {
        "Subtype" => subtype,
        "C" => border.map_or(Object::Array(Vec::new()), |b| nums(&b.color)),
        "IC" => fill.map_or(Object::Array(Vec::new()), |f| nums(&f.color)),
        "BS" => dictionary! { "W" => num(border.map_or(0.0, |b| b.width)), "S" => "S" },
        "CA" => 1,
        "JuliePDF" => dictionary! {
            "v" => 1,
            "borderOpacity" => num(border.map_or(1.0, |b| b.opacity)),
            "fillOpacity" => num(fill.map_or(1.0, |f| f.opacity)),
            "hasBorder" => border.is_some(),
            "hasFill" => fill.is_some(),
            "rect" => nums(&rect),
        },
    }
}

/// `/Line` (two points, `/L`) or `/PolyLine` (`/Vertices`); the arrowhead is
/// the line ending `/OpenArrow` at the last point (`/LE`). `/CA` is the
/// stroke opacity, as for ink.
fn line_dict(points: &[[f64; 2]], arrow: bool, border: &Stroke) -> Dictionary {
    let end = if arrow { "OpenArrow" } else { "None" };
    let mut d = dictionary! {
        "C" => nums(&border.color),
        "CA" => num(border.opacity),
        "BS" => dictionary! { "W" => num(border.width), "S" => "S" },
        "LE" => vec![Object::Name(b"None".to_vec()), Object::Name(end.as_bytes().to_vec())],
        "JuliePDF" => dictionary! { "v" => 1 },
    };
    if let [a, b] = points {
        d.set("Subtype", "Line");
        d.set("L", nums(&[a[0], a[1], b[0], b[1]]));
    } else {
        d.set("Subtype", "PolyLine");
        d.set("Vertices", nums(&points.concat()));
    }
    d
}

/// `/C` is the background colour; an empty array (transparent) when there is
/// none, so an update also clears the colour of a previously saved version.
/// `/CA` stays 1: the background opacity lives in the appearance's `GS0` (fill
/// only), and `/CA` would also fade the text. `/JuliePDF` keeps the font size,
/// text colour and background opacity at full real precision for the reader
/// (`/DA` numbers are rounded to 3 decimals).
fn freetext_dict(text: &str, font_size: f64, color: [f64; 3], bg: Option<&Background>, align: TextAlign) -> Dictionary {
    let da = format!(
        "/Helv {} Tf {} {} {} rg",
        fmt_num(font_size),
        fmt_num(color[0]),
        fmt_num(color[1]),
        fmt_num(color[2])
    );
    let hex = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    let ds = format!(
        "font: Helvetica,sans-serif {}pt; color: #{:02X}{:02X}{:02X}",
        fmt_num(font_size),
        hex(color[0]),
        hex(color[1]),
        hex(color[2])
    );
    dictionary! {
        "Subtype" => "FreeText",
        "Contents" => text_string(text),
        "DA" => Object::String(da.into_bytes(), StringFormat::Literal),
        "DS" => Object::String(ds.into_bytes(), StringFormat::Literal),
        "Q" => match align {
            TextAlign::Left => 0,
            TextAlign::Center => 1,
            TextAlign::Right => 2,
        },
        "C" => bg.map_or(Object::Array(Vec::new()), |b| nums(&b.color)),
        "CA" => 1,
        "BS" => dictionary! { "W" => 0 },
        "JuliePDF" => dictionary! {
            "v" => 1,
            "fontSize" => num(font_size),
            "textColor" => nums(&color),
            "hasBg" => bg.is_some(),
            "bgOpacity" => num(bg.map_or(1.0, |b| b.opacity)),
        },
    }
}

/// A plan's `/Rotate`, normalised to 0..360; it must be a multiple of 90.
fn plan_rotation(rotate: i32) -> Result<i32, AppError> {
    let r = rotate.rem_euclid(360);
    if r % 90 == 0 {
        Ok(r)
    } else {
        Err(AppError::InvalidPdf(format!("invalid page rotation {rotate}")))
    }
}

/// The value of an inheritable page attribute from the nearest ancestor `/Pages` node.
fn inherited<'a>(doc: &'a Document, page: &'a Dictionary, key: &[u8]) -> Option<&'a Object> {
    let mut node = page.get_deref(b"Parent", doc).and_then(Object::as_dict).ok();
    // Bounded walk: a malformed /Parent cycle must not hang the save.
    for _ in 0..64 {
        let d = node?;
        if let Ok(v) = d.get(key) {
            return Some(v);
        }
        node = d.get_deref(b"Parent", doc).and_then(Object::as_dict).ok();
    }
    None
}

/// Page `id`'s dictionary as a direct kid of `root` with `/Rotate rotate`:
/// the attributes it inherited from its old ancestors are copied into it.
pub(crate) fn flattened_page(doc: &Document, id: ObjectId, root: ObjectId, rotate: i32) -> Result<Dictionary, AppError> {
    let page = doc.get_dictionary(id).map_err(invalid)?;
    let mut dict = page.clone();
    for key in [b"MediaBox".as_slice(), b"CropBox", b"Resources"] {
        if !dict.has(key)
            && let Some(v) = inherited(doc, page, key)
        {
            dict.set(key, v.clone());
        }
    }
    dict.set("Parent", root);
    dict.set("Rotate", rotate);
    Ok(dict)
}

/// The page's `/Rotate` (inherited through `/Parent`), normalised to 0..360;
/// 0 when absent or not a multiple of 90.
pub(crate) fn page_rotation(doc: &Document, page_id: ObjectId) -> i32 {
    let mut node = doc.get_dictionary(page_id).ok();
    // Bounded walk: a malformed /Parent cycle must not hang the save.
    for _ in 0..64 {
        let Some(d) = node else { break };
        if let Ok(r) = d.get_deref(b"Rotate", doc).and_then(Object::as_i64) {
            let r = r.rem_euclid(360) as i32;
            return if r % 90 == 0 { r } else { 0 };
        }
        node = d.get_deref(b"Parent", doc).and_then(Object::as_dict).ok();
    }
    0
}

fn blend_name(b: Blend) -> &'static str {
    match b {
        Blend::Normal => "normal",
        Blend::Multiply => "multiply",
    }
}

fn check_finite<'a>(values: impl IntoIterator<Item = &'a f64>) -> Result<(), AppError> {
    if values.into_iter().all(|v| v.is_finite()) {
        Ok(())
    } else {
        Err(AppError::InvalidPdf(
            "annotation contains a non-finite number".into(),
        ))
    }
}

fn common_entries(d: &mut Dictionary, c: &Common) {
    d.set("Type", "Annot");
    d.set("NM", text_string(&c.id));
    d.set(
        "M",
        Object::String(pdf_date(&c.modified_at).into_bytes(), StringFormat::Literal),
    );
    let author = if c.author.is_empty() { "JuliePDF" } else { &c.author };
    d.set("T", text_string(author));
    d.set("F", 4);
}

fn num(v: f64) -> Object {
    if v.fract() == 0.0 && v.abs() < 1e15 {
        Object::Integer(v as i64)
    } else {
        Object::Real(v as f32)
    }
}

fn nums(values: &[f64]) -> Object {
    Object::Array(values.iter().map(|&v| num(v)).collect())
}

/// Adds the form XObject for an appearance whose content uses absolute
/// user-space coordinates (and its transparency group form, if any) to `doc`.
/// `image` is the image XObject an image appearance paints as `/Im0`.
fn add_appearance(doc: &mut Document, ap: &Appearance, image: Option<ObjectId>) -> Result<ObjectId, AppError> {
    let mut gs =
        dictionary! { "Type" => "ExtGState", "CA" => num(ap.opacity), "ca" => num(ap.opacity) };
    if ap.multiply {
        gs.set("BM", "Multiply");
    }
    let mut gstates = dictionary! { "GS0" => gs };
    for g in &ap.gstates {
        let mut d = dictionary! { "Type" => "ExtGState" };
        if let Some(o) = g.fill_opacity {
            d.set("ca", num(o));
        }
        if let Some(o) = g.stroke_opacity {
            d.set("CA", num(o));
        }
        gstates.set(g.name, d);
    }
    let mut resources = dictionary! { "ExtGState" => gstates };
    if let Some(group) = &ap.group {
        // Isolated knockout group drawing opaque paths: the outer stream's GS0
        // applies opacity and blend mode once to the composited group.
        let dict = dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "FormType" => 1,
            "BBox" => nums(&ap.bbox),
            "Resources" => Dictionary::new(),
            "Group" => dictionary! { "S" => "Transparency", "I" => true, "K" => true },
        };
        let id = doc.add_object(compressed_stream(dict, group)?);
        resources.set("XObject", dictionary! { "Fm0" => id });
    }
    if ap.image {
        let im = image.ok_or_else(|| AppError::InvalidPdf("image appearance without an image".into()))?;
        resources.set("XObject", dictionary! { "Im0" => im });
    }
    if ap.uses_helvetica {
        resources.set(
            "Font",
            dictionary! {
                "Helv" => dictionary! {
                    "Type" => "Font",
                    "Subtype" => "Type1",
                    "BaseFont" => "Helvetica",
                    "Encoding" => "WinAnsiEncoding",
                },
            },
        );
    }
    let matrix = ap.matrix.unwrap_or([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
    let dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Form",
        "FormType" => 1,
        "BBox" => nums(&ap.bbox),
        "Matrix" => nums(&matrix),
        "Resources" => resources,
    };
    Ok(doc.add_object(compressed_stream(dict, &ap.content)?))
}

/// A Flate-compressed stream (uncompressed if that is not smaller). Uses the
/// fast level: lopdf's `Stream::compress` uses the best level, which costs
/// about 0.25 ms per pen-stroke appearance for a few percent of size.
fn compressed_stream(mut dict: Dictionary, content: &[u8]) -> Result<Stream, AppError> {
    use flate2::{Compression, write::ZlibEncoder};
    use std::io::Write;
    let mut enc = ZlibEncoder::new(Vec::with_capacity(content.len() / 2), Compression::fast());
    enc.write_all(content).map_err(|e| AppError::Io(e.to_string()))?;
    let packed = enc.finish().map_err(|e| AppError::Io(e.to_string()))?;
    if packed.len() < content.len() {
        dict.set("Filter", "FlateDecode");
        Ok(Stream::new(dict, packed))
    } else {
        Ok(Stream::new(dict, content.to_vec()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_integers_when_whole() {
        assert_eq!(num(4.0), Object::Integer(4));
        assert_eq!(num(0.5), Object::Real(0.5));
    }
}
