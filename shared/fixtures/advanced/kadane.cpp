#include <iostream>
int main(){int n;std::cin>>n;int a[30]={};for(int i=0;i<n;i=i+1){std::cin>>a[i];}int best=0;int current=0;for(int i=0;i<n;i=i+1){if(i==0 || current<0){current=a[i];}else{current=current+a[i];}if(i==0 || current>best){best=current;}}std::cout<<best;return 0;}
