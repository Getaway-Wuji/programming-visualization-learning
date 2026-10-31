#include <iostream>
int main(){int n;std::cin>>n;int a[30]={};int dp[30]={};int best=0;for(int i=0;i<n;i=i+1){std::cin>>a[i];dp[i]=1;for(int j=0;j<i;j=j+1){if(a[j]<a[i] && dp[j]+1>dp[i]){dp[i]=dp[j]+1;}}if(dp[i]>best){best=dp[i];}}std::cout<<best;return 0;}
