import type { ComponentProps } from 'react';
import { JavaBlocks } from '../java/JavaBlocks';
import { cppFromBlocks, cppToolbox } from './blocks';

export default function BlockPane(
  props: Pick<ComponentProps<typeof JavaBlocks>, 'initial' | 'disabled' | 'apply' | 'onDirty'>,
) {
  return <JavaBlocks {...props} language="C++" toolbox={cppToolbox} generate={cppFromBlocks} />;
}
