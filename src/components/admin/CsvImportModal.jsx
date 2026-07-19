import React, { useState, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { Upload, Download, X, RefreshCw, FileSpreadsheet } from 'lucide-react';

const parseDelimitedText = (text, delimiter) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      row.push(field); field = '';
    } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else field += character;
  }
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
};

const parseCsvFile = async (file, options) => {
  const text = await file.text();
  const sample = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = (options.delimitersToGuess || [',']).reduce((best, candidate) =>
    sample.split(candidate).length > sample.split(best).length ? candidate : best, options.delimitersToGuess?.[0] || ',');
  const rows = parseDelimitedText(text, delimiter);
  const headers = (rows.shift() || []).map((header) => options.transformHeader ? options.transformHeader(header) : header);
  const data = rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, options.transform ? options.transform(cells[index] || '') : cells[index] || ''])));
  options.complete({ data, meta: { fields: headers } });
};

export default function CsvImportModal({ isOpen, onClose, store, showNotification, isArabic, onSuccess, onImportComplete }) {
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const downloadSampleCSV = () => {
    const headers = 'category_name,product_name,price,group_name,modifier_name,modifier_price\n';
    const sampleRows = isArabic ? [
      'برجر,برجر لحم كلاسيك,9.50,12.0,الحجم,شريحة جبنة إضافية,0.50',
      'برجر,برجر لحم كلاسيك,9.50,12.0,الحجم,قطعة لحم إضافية,2.50',
      'مقبلات,بطاطس مقلية كبير,3.50,12.0,,,',
      'مشروبات,كوكا كولا,2.50,12.0,النكهة,فانيليا,0.50'
    ].join('\n') : [
      'Burgers,Bel Beef Burger,9.50,Size,Cheese Slice,0.50',
      'Burgers,Bel Beef Burger,9.50,Size,Double Patty,2.50',
      'Sides,Fries Large,3.50,,,',
      'Drinks,Coca Cola,2.50,Flavor,Vanilla,0.50'
    ].join('\n');
    
    // Prefix UTF-8 BOM to ensure Excel opens Arabic characters correctly
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), headers + sampleRows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "cashmint_advanced_menu_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const sanitizePrice = (val) => {
    if (val === undefined || val === null || val === '') return null;
    let str = val.toString().replace(/^\uFEFF/, '').trim();
    if (str.includes(',') && !str.includes('.')) {
      str = str.replace(',', '.');
    } else if (str.includes(',') && str.includes('.')) {
      str = str.replace(/,/g, '');
    }
    const clean = str.replace(/[^0-9.]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  };

  const handleFileChange = (file) => {
    if (!file) return;
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      showNotification(isArabic ? "يرجى تحميل ملف CSV فقط" : "Please upload a CSV file only", "error");
      return;
    }

    setFileName(file.name);

    parseCsvFile(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      delimitersToGuess: [',', ';', '\t', '|'],
      transformHeader: (h) => h.replace(/^\uFEFF/, '').replace(/['"]/g, '').toLowerCase().trim(),
      transform: (v) => v.replace(/^\uFEFF/, '').trim(),
      complete: (results) => {
        try {
          const headers = results.meta.fields || [];
          console.log("Parsed CSV Headers:", headers);
          
          const parsed = results.data;
          if (!parsed || parsed.length === 0) {
            showNotification(isArabic ? "ملف CSV فارغ أو غير صالح" : "CSV file is empty or invalid", "error");
            return;
          }
          console.log("Mapped Row Sample:", parsed[0]);

          // Strict Normalized Header Mapper
          const getHeaderMapping = (hdrs) => {
            let modifierPriceHeader = hdrs.find(h => {
              const clean = h.toLowerCase();
              return clean.includes('modifier_price') || clean.includes('modifier price') || clean.includes('سعر الإضافة') || clean.includes('سعر_الإضافة') || (clean.includes('modifier') && clean.includes('price')) || (clean.includes('إضافة') && clean.includes('سعر')) || (clean.includes('اضافة') && clean.includes('سعر'));
            });

            let priceHeader = hdrs.find(h => {
              const clean = h.toLowerCase();
              if (clean === modifierPriceHeader?.toLowerCase()) return false;
              if (clean.includes('modifier') || clean.includes('إضافة') || clean.includes('اضافة')) return false;
              return clean.includes('price') || clean.includes('سعر');
            });

            let modifierNameHeader = hdrs.find(h => {
              const clean = h.toLowerCase();
              return (clean.includes('modifier') && !clean.includes('price')) || clean.includes('إضافة') || clean.includes('اضافة') || clean.includes('option');
            });

            let groupNameHeader = hdrs.find(h => {
              const clean = h.toLowerCase();
              return clean.includes('group') || clean.includes('مجموعة');
            });

            let productNameHeader = hdrs.find(h => {
              const clean = h.toLowerCase();
              if (clean.includes('modifier') || clean.includes('group') || clean.includes('category') || clean.includes('تصنيف') || clean.includes('قسم')) return false;
              return clean.includes('product') || clean.includes('item') || clean.includes('اسم') || clean.includes('صنف') || clean.includes('الاسم');
            });

            let categoryHeader = hdrs.find(h => {
              const clean = h.toLowerCase();
              return clean.includes('category') || clean.includes('تصنيف') || clean.includes('قسم');
            });

            return {
              categoryHeader,
              productNameHeader,
              priceHeader,
              groupNameHeader,
              modifierNameHeader,
              modifierPriceHeader
            };
          };

          const mapping = getHeaderMapping(headers);

          const formatted = parsed.map((row, index) => {
            const keys = Object.keys(row);

            // Mapping with positional fallback
            const rawCategory = mapping.categoryHeader ? row[mapping.categoryHeader] : row[keys[0]];
            const rawName = mapping.productNameHeader ? row[mapping.productNameHeader] : row[keys[1]];
            const rawPrice = mapping.priceHeader ? row[mapping.priceHeader] : row[keys[2]];
            const rawGroup = mapping.groupNameHeader ? row[mapping.groupNameHeader] : row[keys[3]];
            const rawModName = mapping.modifierNameHeader ? row[mapping.modifierNameHeader] : row[keys[4]];
            const rawModPrice = mapping.modifierPriceHeader ? row[mapping.modifierPriceHeader] : row[keys[5]];

            const category = rawCategory ? rawCategory.toString().trim() : (isArabic ? 'عام' : 'General');
            const name = rawName ? rawName.toString().trim() : '';
            const price = sanitizePrice(rawPrice);
            const groupName = rawGroup ? rawGroup.toString().trim() : null;
            const modifierName = rawModName ? rawModName.toString().trim() : null;
            const modifierPrice = sanitizePrice(rawModPrice) !== null ? sanitizePrice(rawModPrice) : 0.00;

            // Validation
            const errors = [];
            if (!name) {
              errors.push(isArabic ? "اسم المنتج مفقود" : "Product name is missing");
            }
            if (price === null) {
              errors.push(isArabic ? "السعر مفقود أو غير صالح" : "Price is missing or invalid");
            }

            return {
              id: index,
              category_name: category,
              product_name: name,
              price: price !== null ? price : 0.00,
              group_name: groupName,
              modifier_name: modifierName,
              modifier_price: modifierPrice,
              isValid: errors.length === 0,
              errors: errors
            };
          });

          setParsedRows(formatted);
        } catch (err) {
          console.error("CSV Parsing Error:", err);
          showNotification(isArabic ? "فشل قراءة الملف" : "Failed to read CSV file", "error");
        }
      },
    }).catch((err) => {
      console.error("CSV parsing error:", err);
      showNotification(isArabic ? "حدث خطأ أثناء قراءة الملف" : "An error occurred while reading the file", "error");
    });
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileChange(file);
    }
    e.target.value = '';
  };

  const handleImportSubmit = async (e) => {
    e.preventDefault();
    if (!store?.id) return;

    const validRows = parsedRows.filter(r => r.isValid);
    if (validRows.length === 0) {
      showNotification(
        isArabic 
          ? "لا توجد صفوف صالحة للاستيراد!" 
          : "No valid rows to import!", 
        "error"
      );
      return;
    }

    try {
      setImporting(true);

      // 1. Extract unique categories from parsed rows and insert missing ones
      const uniqueCategoryNames = [...new Set(validRows.map(item => item.category_name))];

      // Fetch existing categories for store
      const { data: existingCats, error: fetchErr } = await supabase
        .from('categories')
        .select('id, name')
        .eq('store_id', store.id);

      if (fetchErr) throw fetchErr;

      const categoryMap = new Map(existingCats?.map(c => [c.name.toLowerCase().trim(), c.id]) || []);
      const newCategoriesToInsert = uniqueCategoryNames
        .filter(name => !categoryMap.has(name.toLowerCase().trim()))
        .map(name => ({
          name: name.trim(),
          store_id: store.id
        }));

      let insertedCategoriesCount = 0;
      if (newCategoriesToInsert.length > 0) {
        const { data: insertedCats, error: insertCatErr } = await supabase
          .from('categories')
          .insert(newCategoriesToInsert)
          .select('id, name');

        if (insertCatErr) throw insertCatErr;
        
        insertedCats.forEach(c => {
          categoryMap.set(c.name.toLowerCase().trim(), c.id);
        });
        insertedCategoriesCount = insertedCats.length;
      }

      // Import deliberately maps each menu category to a same-named accounting
      // group. It never guesses a tax rate or assigns a legacy default.
      const { data: existingAccountingGroups, error: accountingGroupsErr } = await supabase
        .from('accounting_groups').select('id,name').eq('store_id', store.id);
      if (accountingGroupsErr) throw accountingGroupsErr;
      const accountingGroupMap = new Map((existingAccountingGroups || []).map(group => [group.name.toLowerCase().trim(), group.id]));
      const missingAccountingGroups = uniqueCategoryNames
        .filter(name => !accountingGroupMap.has(name.toLowerCase().trim()))
        .map(name => ({ store_id: store.id, name: name.trim(), tax_profile_id: null, is_active: true, is_default: false }));
      if (missingAccountingGroups.length > 0) {
        const { data: insertedAccountingGroups, error: insertAccountingGroupsErr } = await supabase
          .from('accounting_groups').insert(missingAccountingGroups).select('id,name');
        if (insertAccountingGroupsErr) throw insertAccountingGroupsErr;
        insertedAccountingGroups.forEach(group => accountingGroupMap.set(group.name.toLowerCase().trim(), group.id));
      }

      // 2. Resolve Unique Products
      const uniqueProductsMap = new Map();
      validRows.forEach(row => {
        const catId = categoryMap.get(row.category_name.toLowerCase().trim());
        const key = `${catId}|${row.product_name.toLowerCase().trim()}`;
        if (!uniqueProductsMap.has(key)) {
          uniqueProductsMap.set(key, {
            name: row.product_name.trim(),
            price: row.price,
            category_id: catId,
            store_id: store.id,
            accounting_group_id: accountingGroupMap.get(row.category_name.toLowerCase().trim()),
            vat_rate: null
          });
        }
      });

      // Fetch existing products to avoid duplicating them
      const { data: existingProds, error: fetchProdErr } = await supabase
        .from('products')
        .select('id, name, category_id')
        .eq('store_id', store.id);

      if (fetchProdErr) throw fetchProdErr;

      const productMap = new Map();
      existingProds?.forEach(p => {
        const key = `${p.category_id}|${p.name.toLowerCase().trim()}`;
        productMap.set(key, p.id);
      });

      const newProductsToInsert = [...uniqueProductsMap.values()].filter(p => {
        const key = `${p.category_id}|${p.name.toLowerCase().trim()}`;
        return !productMap.has(key);
      });

      let insertedProductsCount = 0;
      if (newProductsToInsert.length > 0) {
        const { data: insertedProds, error: insertProdErr } = await supabase
          .from('products')
          .insert(newProductsToInsert)
          .select('id, name, category_id');

        if (insertProdErr) throw insertProdErr;

        insertedProds.forEach(p => {
          const key = `${p.category_id}|${p.name.toLowerCase().trim()}`;
          productMap.set(key, p.id);
        });
        insertedProductsCount = insertedProds.length;
      }

      // 3. Resolve Unique Option Groups (item_groups)
      const uniqueGroupNames = [...new Set(validRows.filter(r => r.group_name).map(r => r.group_name))];

      const { data: existingGroups, error: fetchGroupErr } = await supabase
        .from('item_groups')
        .select('id, name')
        .eq('store_id', store.id);

      if (fetchGroupErr) throw fetchGroupErr;

      const groupMap = new Map(existingGroups?.map(g => [g.name.toLowerCase().trim(), g.id]) || []);
      const newGroupsToInsert = uniqueGroupNames
        .filter(name => !groupMap.has(name.toLowerCase().trim()))
        .map(name => ({
          name: name.trim(),
          store_id: store.id,
          is_required: false,
          min_items: 0,
          max_items: null,
          price_strategy: 'keep_initial',
          group_price: 0.00
        }));

      if (newGroupsToInsert.length > 0) {
        const { data: insertedGroups, error: insertGroupErr } = await supabase
          .from('item_groups')
          .insert(newGroupsToInsert)
          .select('id, name');

        if (insertGroupErr) throw insertGroupErr;

        insertedGroups.forEach(g => {
          groupMap.set(g.name.toLowerCase().trim(), g.id);
        });
      }

      // 4. Map Group Mappings & Modifiers
      const groupMappingsToInsert = [];
      const modifiersToInsert = [];

      const processedMappings = new Set();
      const processedModifiers = new Set();

      for (const row of validRows) {
        const catId = categoryMap.get(row.category_name.toLowerCase().trim());
        const prodKey = `${catId}|${row.product_name.toLowerCase().trim()}`;
        const productId = productMap.get(prodKey);

        if (!productId) continue;

        // If option group name is present
        if (row.group_name) {
          const groupId = groupMap.get(row.group_name.toLowerCase().trim());
          if (groupId) {
            const mapKey = `${groupId}|${productId}`;
            if (!processedMappings.has(mapKey)) {
              processedMappings.add(mapKey);
              groupMappingsToInsert.push({
                group_id: groupId,
                product_id: productId,
                store_id: store.id
              });
            }
          }
        }

        // If modifier name is present
        if (row.modifier_name) {
          const modKey = `${productId}|${row.modifier_name.toLowerCase().trim()}`;
          if (!processedModifiers.has(modKey)) {
            processedModifiers.add(modKey);
            modifiersToInsert.push({
              product_id: productId,
              name: row.modifier_name.trim(),
              price_adjustment: row.modifier_price
            });
          }
        }
      }

      // 5. Insert mappings (checking for existing database duplicates)
      if (groupMappingsToInsert.length > 0) {
        const { data: existingMappings } = await supabase
          .from('group_item_mapping')
          .select('group_id, product_id')
          .eq('store_id', store.id);

        const existingMappingsSet = new Set(
          existingMappings?.map(m => `${m.group_id}|${m.product_id}`) || []
        );

        const finalMappings = groupMappingsToInsert.filter(m => {
          const key = `${m.group_id}|${m.product_id}`;
          return !existingMappingsSet.has(key);
        });

        if (finalMappings.length > 0) {
          const { error: insMapErr } = await supabase
            .from('group_item_mapping')
            .insert(finalMappings);

          if (insMapErr) throw insMapErr;
        }
      }

      // 6. Insert modifiers (checking for existing database duplicates)
      if (modifiersToInsert.length > 0) {
        const prodIds = [...new Set(modifiersToInsert.map(m => m.product_id))];
        
        const { data: existingModifiers } = await supabase
          .from('modifiers')
          .select('product_id, name')
          .in('product_id', prodIds);

        const existingModifiersSet = new Set(
          existingModifiers?.map(m => `${m.product_id}|${m.name.toLowerCase().trim()}`) || []
        );

        const finalModifiers = modifiersToInsert.filter(m => {
          const key = `${m.product_id}|${m.name.toLowerCase().trim()}`;
          return !existingModifiersSet.has(key);
        });

        if (finalModifiers.length > 0) {
          const { error: insModErr } = await supabase
            .from('modifiers')
            .insert(finalModifiers);

          if (insModErr) throw insModErr;
        }
      }

      showNotification(
        isArabic 
          ? `تم استيراد ${insertedProductsCount} منتج جديد و ${insertedCategoriesCount} تصنيف بنجاح!` 
          : `Imported ${insertedProductsCount} new products and ${insertedCategoriesCount} categories successfully!`,
        "success"
      );

      // Cleanup & Close
      setFileName('');
      setParsedRows([]);
      if (onSuccess) onSuccess();
      if (onImportComplete) onImportComplete();
      onClose();

    } catch (err) {
      console.error("CSV Import Error:", err);
      showNotification(isArabic ? `فشل الاستيراد: ${err.message}` : `Import failed: ${err.message}`, "error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[85vh] text-right" dir={isArabic ? 'rtl' : 'ltr'}>
        
        {/* Header */}
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-850 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-indigo-500" />
            <span>{isArabic ? "استيراد قائمة الطعام من ملف CSV" : "Import Menu from CSV"}</span>
          </h3>
          <button 
            onClick={() => {
              if (!importing) {
                setFileName('');
                setParsedRows([]);
                onClose();
              }
            }} 
            className="text-slate-450 hover:text-slate-850"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Instructions and Download Template */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-indigo-50/30 border border-indigo-100/30 rounded-2xl text-xs">
            <div className="space-y-1">
              <p className="font-bold text-slate-800">
                {isArabic ? "تأكد من مطابقة ملف CSV للأعمدة التالية (بما في ذلك المجموعات والإضافات الاختيارية):" : "Make sure your CSV matches the required columns (including optional option groups & modifiers):"}
              </p>
              <code className="text-indigo-600 font-mono font-bold block whitespace-pre-wrap">
                category_name, product_name, price, group_name, modifier_name, modifier_price
              </code>
            </div>
            <button
              onClick={downloadSampleCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-indigo-200 text-indigo-600 rounded-xl hover:bg-indigo-50 font-bold transition-all shrink-0 active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isArabic ? "تحميل نموذج ملف CSV" : "Download CSV Template"}</span>
            </button>
          </div>

          {/* Drag & Drop File Zone */}
          {parsedRows.length === 0 && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragActive(false);
                if (e.dataTransfer.files?.[0]) {
                  handleFileChange(e.dataTransfer.files[0]);
                }
              }}
              className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
                isDragActive 
                  ? 'border-indigo-500 bg-indigo-50/20' 
                  : fileName 
                  ? 'border-emerald-500 bg-emerald-50/10' 
                  : 'border-slate-200 hover:border-slate-350 bg-slate-50/50'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
                disabled={importing}
              />
              
              <div className="space-y-2 flex flex-col items-center">
                <div className="p-3 bg-indigo-50 text-indigo-500 rounded-full">
                  <Upload className="w-5 h-5" />
                </div>
                
                <div>
                  <p className="text-xs font-bold text-slate-700">
                    {isArabic ? "اسحب وأفلت ملف الـ CSV هنا أو تصفح ملفاتك" : "Drag & drop CSV file here or browse"}
                  </p>
                  <p className="text-[9px] text-slate-400 font-bold mt-1">
                    {isArabic ? "يدعم صيغ CSV فقط" : "Supports CSV format only"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Preview Table */}
          {parsedRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-500">
                    {isArabic ? `معاينة البيانات (${parsedRows.length} صف)` : `Data Preview (${parsedRows.length} rows)`}
                  </span>
                  {parsedRows.some(r => !r.isValid) && (
                    <span className="bg-red-100 text-red-700 text-[9px] px-2 py-0.5 rounded-full font-bold">
                      {isArabic 
                        ? `سيتم تجاهل ${parsedRows.filter(r => !r.isValid).length} صف غير صالح` 
                        : `${parsedRows.filter(r => !r.isValid).length} invalid rows will be ignored`}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => {
                    setFileName('');
                    setParsedRows([]);
                  }}
                  className="text-red-550 hover:text-red-655 text-[10px] font-bold transition-all"
                >
                  {isArabic ? "حذف الملف الحالي" : "Clear File"}
                </button>
              </div>

              <div className="border border-slate-100 rounded-xl overflow-hidden max-h-[40vh] overflow-y-auto">
                <table className="w-full text-right text-xs" dir={isArabic ? 'rtl' : 'ltr'}>
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100 sticky top-0">
                    <tr>
                      <th className="p-2.5 text-right">{isArabic ? "التصنيف" : "Category"}</th>
                      <th className="p-2.5 text-right">{isArabic ? "اسم المنتج" : "Product"}</th>
                      <th className="p-2.5 text-center">{isArabic ? "السعر" : "Price"}</th>
                      <th className="p-2.5 text-right">{isArabic ? "مجموعة الخيارات" : "Option Group"}</th>
                      <th className="p-2.5 text-right">{isArabic ? "الإضافة" : "Modifier"}</th>
                      <th className="p-2.5 text-center">{isArabic ? "سعر الإضافة" : "Mod. Price"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {parsedRows.map((row) => (
                      <tr key={row.id} className={`hover:bg-slate-50/55 ${!row.isValid ? 'bg-red-50/40 text-red-700' : ''}`}>
                        <td className="p-2.5 font-medium">{row.category_name}</td>
                        <td className="p-2.5 font-medium">
                          <div>
                            <span>{row.product_name || <span className="text-red-500 italic font-normal">{isArabic ? "(اسم مفقود)" : "(Name missing)"}</span>}</span>
                            {!row.isValid && (
                              <div className="text-[9px] text-red-500 font-bold flex flex-col gap-0.5 mt-1">
                                {row.errors.map((err, i) => (
                                  <span key={i}>• {err}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-2.5 text-center font-mono font-semibold">
                          {row.isValid ? row.price.toFixed(2) : (
                            <span className="text-red-500">{isArabic ? "غير صالح" : "Invalid"}</span>
                          )}
                        </td>
                        <td className="p-2.5 font-medium text-slate-500">{row.group_name || '-'}</td>
                        <td className="p-2.5 font-medium text-slate-500">{row.modifier_name || '-'}</td>
                        <td className="p-2.5 text-center font-mono text-slate-500">
                          {row.modifier_name ? row.modifier_price.toFixed(2) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex gap-2">
          <button
            onClick={handleImportSubmit}
            disabled={importing || parsedRows.length === 0}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] disabled:bg-indigo-300 disabled:scale-100 text-white font-bold text-xs py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {importing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{isArabic ? "جاري استيراد وحفظ البيانات..." : "Importing and saving data..."}</span>
              </>
            ) : (
              <span>{isArabic ? "حفظ وتأكيد الاستيراد" : "Confirm & Save Import"}</span>
            )}
          </button>
          <button
            onClick={() => {
              setFileName('');
              setParsedRows([]);
              onClose();
            }}
            disabled={importing}
            className="px-4 border border-slate-200 bg-white text-slate-600 font-bold text-xs py-2.5 rounded-xl hover:bg-slate-50 transition-all"
          >
            {isArabic ? "إلغاء" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
