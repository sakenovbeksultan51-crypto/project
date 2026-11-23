"""Choose trained weights only if tiled table search and person detection pass on both splits."""
import pathlib,json,shutil,hashlib
root=pathlib.Path('/workspace/work/training');out=root/'table-experiment';repo=pathlib.Path(__file__).resolve().parents[1]
r=json.loads((out/'report.json').read_text());reports={split:{tag:json.loads((out/f'tile-{split}-{tag}.json').read_text()) for tag in ['baseline','trained']} for split in ['val','test']}
def passes(split):
 b=reports[split]['baseline']['metrics']['tiles_040'];c=reports[split]['trained']['metrics']['tiles_040']
 personb=r['baseline_validation' if split=='val' else 'baseline_test']['person'];personc=(r['candidates_validation']['best'] if split=='val' else r.get('best_candidate_test') or r['selected_candidate_test'])['person']
 return (b['small_tp']+b['small_fn']>=4 and c['small_recall']>=b['small_recall']+.05 and c['recall']>=b['recall']+.02 and c['precision']>=b['precision']-.04 and personc['recall']>=personb['recall']-.03 and personc['precision']>=personb['precision']-.03)
accept=all(passes(s) for s in ['val','test']);r['full_frame_selection']=r['selected'];r['selected']='best-tiled' if accept else 'pretrained';r['pipeline_selection']={'selected':r['selected'],'rule':'On both validation and held-out test: at least four small table annotations; tiled small-table recall +0.05 and overall recall +0.02, precision decrease at most 0.04; full-frame person recall and precision decrease at most 0.03.','threshold':.4,'note':'Model selection involved the COCO validation split. Test is a held-out image subset, but has also been used to check the search pipeline. Neither set is the user restaurant. Cross-frame confirmation is not measured by this single-frame benchmark.','validation':{k:v['metrics']['tiles_040'] for k,v in reports['val'].items()},'test':{k:v['metrics']['tiles_040'] for k,v in reports['test'].items()}}
if accept:
 weights=out/'fit/weights/best.onnx';shutil.copyfile(weights,repo/'public/models/yolo/person.onnx');p=repo/'public/models/yolo/provenance.json';prov=json.loads((root/'pre-table-provenance.json').read_text());prov.update(weights='table-finetuned',onnx_sha256=hashlib.sha256(weights.read_bytes()).hexdigest(),training_report='table-training-report.json',checkpoint='best');p.write_text(json.dumps(prov,indent=2))
else:
 shutil.copyfile(root/'pre-table-person.onnx',repo/'public/models/yolo/person.onnx');shutil.copyfile(root/'pre-table-provenance.json',repo/'public/models/yolo/provenance.json')
for p in [out/'report.json',repo/'ml/table-report.json',repo/'public/models/yolo/table-training-report.json']:p.write_text(json.dumps(r,indent=2))
(repo/'public/models/yolo/table-search-report.json').write_text(json.dumps({'selection':r['pipeline_selection'],'reports':reports},indent=2))
print(json.dumps(r['pipeline_selection'],indent=2))
