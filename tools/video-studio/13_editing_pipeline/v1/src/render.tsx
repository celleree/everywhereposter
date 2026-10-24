import React from 'react';
import {Composition,registerRoot} from 'remotion';
import {Film} from './Film';
import {validateProject} from '../project.mjs';
registerRoot(()=> <Composition id="DirectedEdit" component={Film} defaultProps={{project:null}} width={1080} height={1920} fps={30} durationInFrames={1} calculateMetadata={({props})=>{const p=props.project;return{...p.canvas,durationInFrames:validateProject(p).frames};}}/>);
